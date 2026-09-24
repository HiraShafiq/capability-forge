import type { Action, Capability, RunResult } from '../core/schemas.js';
import type { BrowserSurface } from '../surface/browser-surface.js';
import { EvidenceRecorder } from '../observability/evidence.js';
import { Guardrails, PolicyViolation } from '../policy/guardrails.js';
import { newId } from '../utils/ids.js';
import { parsePrimitive, renderTemplate } from '../utils/template.js';
import type { ControlPlane } from '../handoff/control-plane.js';

export async function replay(options: {
  capability: Capability;
  inputs: Record<string, unknown>;
  surface: BrowserSurface;
  variant?: string;
  entryUrlOverride?: string;
  evidenceRoot?: string;
  controlPlane?: ControlPlane;
  interventionTimeoutMs?: number;
}): Promise<RunResult> {
  const runId = newId('replay');
  const started = Date.now();
  const evidence = new EvidenceRecorder(runId, 'replay', options.evidenceRoot);
  const outputs: Record<string, unknown> = {};
  const guardrails = new Guardrails(options.capability);
  const capabilityId = options.capability.capability.id;

  try {
    validateInputs(options.capability, options.inputs);
    await evidence.event({ phase: 'replay', type: 'run_started', data: { capabilityId, version: options.capability.capability.version, variant: options.variant } });

    for (const original of options.capability.steps) {
      const action = specialize(original, options);
      await handleExceptionalState(options, action, evidence, runId);
      const outcome = await detectBusinessOutcome(options);
      if (outcome) {
        const result: RunResult = { status: 'business_outcome', runId, capabilityId, code: outcome.code, message: outcome.description, durationMs: Date.now() - started };
        await evidence.event({ phase: 'replay', type: 'business_outcome', stepId: action.id, data: result });
        await evidence.writeJson('result.json', result); return result;
      }
      guardrails.assertAction(action, options.inputs, action.kind === 'navigate' ? action.url : options.surface.currentUrl());
      await evidence.event({ phase: 'replay', type: 'step_started', stepId: action.id, data: { kind: action.kind, target: 'target' in action ? action.target.description : undefined } });
      await execute(action, options.surface, options.inputs, outputs);
      await evidence.event({ phase: 'replay', type: 'step_completed', stepId: action.id, data: { kind: action.kind } });
    }

    const outcome = await detectBusinessOutcome(options);
    if (outcome) {
      const result: RunResult = { status: 'business_outcome', runId, capabilityId, code: outcome.code, message: outcome.description, durationMs: Date.now() - started };
      await evidence.writeJson('result.json', result); return result;
    }
    if (!(await options.surface.exists(options.capability.success.checkpoint))) {
      throw failure('CHECKPOINT_FAILED', 'Final success checkpoint was not observed', options.capability.steps.at(-1)?.id, options.capability.success.description);
    }
    for (const name of Object.keys(options.capability.contract.outputs)) if (!(name in outputs)) throw failure('OUTPUT_MISSING', `Declared output ${name} was not extracted`);
    const result: RunResult = { status: 'success', runId, capabilityId, outputs, durationMs: Date.now() - started };
    await evidence.event({ phase: 'replay', type: 'run_completed', data: { status: 'success', outputNames: Object.keys(outputs) } });
    await evidence.writeJson('result.json', redactResultOutputs(options.capability, result)); return result;
  } catch (error) {
    const screenshot = evidence.path('failure.png');
    await options.surface.screenshot(screenshot).catch(() => undefined);
    const detail = normalizeError(error, screenshot);
    const result: RunResult = { status: 'failure', runId, capabilityId, error: detail, durationMs: Date.now() - started };
    await evidence.event({ phase: 'replay', type: 'run_failed', ...(detail.stepId ? { stepId: detail.stepId } : {}), data: { error: detail } });
    await evidence.writeJson('result.json', result); return result;
  }
}

function redactResultOutputs(capability: Capability, result: RunResult): RunResult | Record<string, unknown> {
  if (result.status !== 'success') return result;
  return {
    ...result,
    outputs: Object.fromEntries(Object.entries(result.outputs).map(([name, value]) => [name, capability.contract.outputs[name]?.sensitive ? '[REDACTED_SENSITIVE]' : value]))
  };
}

async function execute(action: Action, surface: BrowserSurface, inputs: Record<string, unknown>, outputs: Record<string, unknown>): Promise<void> {
  switch (action.kind) {
    case 'navigate': await surface.navigate(renderTemplate(action.url, inputs)); break;
    case 'click': await surface.click(action.target); break;
    case 'type': await surface.type(action.target, renderTemplate(action.value, inputs), action.clear); break;
    case 'extract': outputs[action.output] = parsePrimitive(await surface.read(action.target), action.parseAs); break;
    case 'wait': await new Promise((resolve) => setTimeout(resolve, action.milliseconds)); break;
  }
}

function specialize(action: Action, options: Parameters<typeof replay>[0]): Action {
  const variant = options.variant ? options.capability.variants[options.variant] : undefined;
  if (action.kind === 'navigate') return { ...action, url: options.entryUrlOverride ?? variant?.baseUrl ?? action.url };
  const target = variant?.locatorOverrides[action.id];
  return target && 'target' in action ? { ...action, target } : action;
}

async function detectBusinessOutcome(options: Parameters<typeof replay>[0]) {
  for (const outcome of options.capability.businessOutcomes) if (await options.surface.exists(outcome.when)) return outcome;
  return undefined;
}

async function handleExceptionalState(options: Parameters<typeof replay>[0], action: Action, evidence: EvidenceRecorder, runId: string): Promise<void> {
  for (const recovery of options.capability.recoveries) {
    if (!(await options.surface.exists(recovery.when))) continue;
    await evidence.event({ phase: 'replay', type: 'recoverable_condition', stepId: action.id, data: { code: recovery.code, action: recovery.action } });
    if (recovery.action === 'dismiss' && recovery.dismissTarget) {
      await options.surface.click(recovery.dismissTarget);
      if (await options.surface.exists(recovery.when)) throw failure('RECOVERY_EXHAUSTED', `Dismissal did not resolve ${recovery.code}`, action.id);
      return;
    }
    if (recovery.action === 'retry_step') {
      for (let attempt = 1; attempt <= recovery.maxAttempts; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 250 * attempt));
        if (!(await options.surface.exists(recovery.when))) return;
      }
      throw failure('RECOVERY_EXHAUSTED', `${recovery.code} persisted after ${recovery.maxAttempts} retries`, action.id);
    }
    if (!options.controlPlane) throw failure('INTERVENTION_UNAVAILABLE', `Condition ${recovery.code} requires a human operator`, action.id);
    await options.controlPlane.requestAndWait({ runId, capabilityId: options.capability.capability.id, stepId: action.id, reason: `${recovery.code}: ${recovery.description}`, surface: options.surface, evidence, ...(options.interventionTimeoutMs ? { timeoutMs: options.interventionTimeoutMs } : {}) });
    if (await options.surface.exists(recovery.when)) throw failure('INTERVENTION_UNRESOLVED', `Human resumed but ${recovery.code} is still present`, action.id);
  }
}

function validateInputs(capability: Capability, inputs: Record<string, unknown>): void {
  for (const [name, spec] of Object.entries(capability.contract.inputs)) {
    const value = inputs[name];
    if (spec.required && (value === undefined || value === '')) throw failure('INPUT_REQUIRED', `Required input ${name} was not supplied`);
    if (value !== undefined && typeof value !== spec.type) throw failure('INPUT_TYPE', `Input ${name} must be ${spec.type}`);
    if (spec.pattern && typeof value === 'string' && !new RegExp(spec.pattern).test(value)) throw failure('INPUT_VALIDATION', `Input ${name} does not match its declared pattern`);
  }
}

function failure(code: string, message: string, stepId?: string, expected?: string): Error & { code: string; stepId?: string; expected?: string } {
  return Object.assign(new Error(message), { code, ...(stepId ? { stepId } : {}), ...(expected ? { expected } : {}) });
}

function normalizeError(error: unknown, evidencePath: string): { code: string; message: string; stepId?: string; expected?: string; observed?: string; evidencePath?: string } {
  const value = error as Error & { code?: string; stepId?: string; expected?: string; observed?: string };
  return {
    code: value instanceof PolicyViolation ? value.code : value.code ?? 'REPLAY_ERROR',
    message: value.message ?? String(error),
    ...(value.stepId ? { stepId: value.stepId } : {}), ...(value.expected ? { expected: value.expected } : {}),
    ...(value.observed ? { observed: value.observed } : {}), evidencePath
  };
}
