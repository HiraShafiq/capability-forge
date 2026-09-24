import { type Action, type AgentDecision, type Capability } from '../core/schemas.js';
import type { BrowserSurface } from '../surface/browser-surface.js';
import type { DecisionModel } from './model.js';
import { compileCapability, type RecordedAction } from './compiler.js';
import { EvidenceRecorder } from '../observability/evidence.js';
import { newId } from '../utils/ids.js';
import { parsePrimitive } from '../utils/template.js';

export interface DiscoveryResult {
  runId: string;
  artifact: Capability;
  outputs: Record<string, unknown>;
  steps: number;
  model: string;
  evidenceDirectory: string;
}

export async function discover(options: {
  surface: BrowserSurface;
  model: DecisionModel;
  goal: string;
  entryUrl: string;
  inputs: Record<string, unknown>;
  maxSteps?: number;
  timeoutMs?: number;
  evidenceRoot?: string;
}): Promise<DiscoveryResult> {
  const runId = newId('discovery');
  const evidence = new EvidenceRecorder(runId, 'discovery', options.evidenceRoot);
  const history: AgentDecision[] = [];
  const recorded: RecordedAction[] = [];
  const outputs: Record<string, unknown> = {};
  const started = Date.now();
  const allowedOrigin = new URL(options.entryUrl).origin;
  await evidence.event({ phase: 'discovery', type: 'run_started', data: { goal: options.goal, model: options.model.name, entryUrl: options.entryUrl } });
  await options.surface.navigate(options.entryUrl);
  recorded.push({ action: { id: 'step-01', kind: 'navigate', url: options.entryUrl, risk: 'safe' } });

  for (let index = 0; index < (options.maxSteps ?? 12); index++) {
    if (Date.now() - started > (options.timeoutMs ?? 60_000)) throw new Error('Discovery timeout exceeded');
    if (new URL(options.surface.currentUrl()).origin !== allowedOrigin) throw new Error(`Discovery left its allowed origin: ${options.surface.currentUrl()}`);
    const observation = await options.surface.observe();
    const decision = await options.model.decide({ goal: options.goal, observation, history, outputs });
    history.push(decision);
    await evidence.event({ phase: 'discovery', type: 'model_decision', rationale: decision.rationale, data: { decision } });

    if (decision.type === 'escalate') {
      await options.surface.screenshot(evidence.path('escalation.png'));
      throw new Error(`Discovery escalated: ${decision.reason}`);
    }
    if (decision.type === 'complete') {
      const artifact = compileCapability({ runId, entryUrl: options.entryUrl, actions: recorded, successText: decision.successText });
      await evidence.writeJson('capability.json', artifact);
      await evidence.event({ phase: 'discovery', type: 'run_completed', data: { outputNames: Object.keys(outputs), steps: history.length } });
      return { runId, artifact, outputs, steps: history.length, model: options.model.name, evidenceDirectory: evidence.directory };
    }
    if (decision.type === 'act') {
      if (decision.action === 'wait') {
        const action: Action = { id: `step-${String(recorded.length + 1).padStart(2, '0')}`, kind: 'wait', milliseconds: 500, risk: 'safe' };
        await new Promise((resolve) => setTimeout(resolve, 500)); recorded.push({ action }); continue;
      }
      if (!decision.elementRef) throw new Error('Model action did not include elementRef');
      const target = await options.surface.elementTarget(decision.elementRef);
      if (decision.action === 'click' && /delete|restrict|transfer|submit payment|open account|new sub-account|confirm/i.test(target.description)) {
        await evidence.event({ phase: 'discovery', type: 'risky_action_blocked', rationale: decision.rationale, data: { target: target.description } });
        throw new Error(`Discovery blocked a risky control and requires human approval: ${target.description}`);
      }
      if (decision.action === 'click') {
        await options.surface.click(target);
        recorded.push({ action: { id: `step-${String(recorded.length + 1).padStart(2, '0')}`, kind: 'click', target, risk: 'safe' } });
      } else {
        if (!decision.value) throw new Error('Type action did not include a value');
        await options.surface.type(target, decision.value, true);
        const parameterName = Object.entries(options.inputs).find(([, value]) => String(value) === decision.value)?.[0];
        recorded.push({ action: { id: `step-${String(recorded.length + 1).padStart(2, '0')}`, kind: 'type', target, value: decision.value, clear: true, risk: 'safe' }, concreteValue: decision.value, ...(parameterName ? { parameterName } : {}) });
      }
      continue;
    }
    const target = await options.surface.elementTarget(decision.elementRef);
    const raw = await options.surface.read(target);
    outputs[decision.outputName] = parsePrimitive(raw, decision.parseAs);
    recorded.push({ action: { id: `step-${String(recorded.length + 1).padStart(2, '0')}`, kind: 'extract', target, output: decision.outputName, parseAs: decision.parseAs, risk: 'safe' } });
  }
  await options.surface.screenshot(evidence.path('max-steps.png'));
  throw new Error('Discovery max steps reached');
}
