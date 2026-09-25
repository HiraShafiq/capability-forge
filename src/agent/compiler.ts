import { CapabilitySchema, type Action, type Capability } from '../core/schemas.js';

export interface RecordedAction {
  action: Action;
  concreteValue?: string;
  parameterName?: string;
}

export function compileCapability(options: {
  runId: string;
  entryUrl: string;
  actions: RecordedAction[];
  successText: string;
  inputName?: string;
  outputName?: string;
}): Capability {
  const inputName = options.inputName ?? 'memberId';
  const outputName = options.outputName ?? 'savingsBalance';
  const steps = options.actions.map(({ action, concreteValue, parameterName }) => {
    if (action.kind === 'type' && concreteValue && parameterName) return { ...action, value: `{{${parameterName}}}` };
    return action;
  });
  const typeStep = steps.find((step) => step.kind === 'type');
  const clickStep = steps.find((step) => step.kind === 'click');
  const summitOverrides: Record<string, unknown> = {};
  if (typeStep) summitOverrides[typeStep.id] = { description: 'Summit member field', locators: [{ strategy: 'role', role: 'textbox', name: 'Account / Member No.', exact: true }], minimumMatches: 1, maximumMatches: 1 };
  if (clickStep) summitOverrides[clickStep.id] = { description: 'Summit locate button', locators: [{ strategy: 'role', role: 'button', name: 'Locate', exact: true }], minimumMatches: 1, maximumMatches: 1 };
  const origin = new URL(options.entryUrl).origin;
  // The model's completion text is explanatory evidence, not a trusted replay locator.
  // Normalize it to an app-family checkpoint that is present across tenant variants.
  const successMarker = /^DEPOSIT ACCOUNTS$/i.test(options.successText.trim())
    ? options.successText.trim()
    : 'DEPOSIT ACCOUNTS';
  return CapabilitySchema.parse({
    schemaVersion: '1.0',
    capability: {
      id: 'member-savings-balance', name: 'Read member savings balance',
      description: 'Looks up a member in a legacy core-servicing UI and returns the available savings balance.',
      version: '1.0.0', status: 'draft', createdAt: new Date().toISOString(), sourceRunId: options.runId,
      appFamily: 'legacy-core-demo', testedVariants: ['harbor']
    },
    contract: {
      inputs: { [inputName]: { type: 'string', description: 'Training member identifier', required: true, sensitive: true, pattern: '^M-\\d{4}$' } },
      outputs: { [outputName]: { type: 'number', description: 'Available savings balance in USD', required: true, sensitive: true } },
      possibleOutcomes: ['success', 'MEMBER_NOT_FOUND', 'failure']
    },
    policy: {
      allowedOrigins: [origin], allowedPathPatterns: ['^/tenant/(harbor|summit)(/workspace)?$'],
      allowedActions: ['navigate', 'click', 'type', 'extract', 'wait'], riskyActionHandling: 'escalate', persistSensitiveValues: false
    },
    steps,
    success: {
      description: 'Deposit accounts table is visible after the requested balance was extracted.',
      checkpoint: {
        description: 'Deposit accounts table',
        locators: [
          { strategy: 'text', text: successMarker, exact: true },
          { strategy: 'css', selector: 'table[summary="Deposit accounts"]' }
        ],
        minimumMatches: 1,
        maximumMatches: 1
      }
    },
    businessOutcomes: [{
      code: 'MEMBER_NOT_FOUND', description: 'The supplied member identifier does not exist.', status: 'business_outcome',
      when: { description: 'Member not found message', locators: [{ strategy: 'text', text: 'No member was found', exact: false }], minimumMatches: 1, maximumMatches: 1 }
    }],
    recoveries: [
      { code: 'SUPERVISOR_REVIEW', description: 'A supervisor gate blocks automation.', when: { description: 'Supervisor review dialog', locators: [{ strategy: 'role', role: 'dialog', name: 'Supervisor review required', exact: true }], minimumMatches: 1, maximumMatches: 1 }, action: 'escalate', maxAttempts: 0 },
      { code: 'SESSION_EXPIRED', description: 'The authenticated application session expired.', when: { description: 'Session expired alert', locators: [{ strategy: 'text', text: 'SESSION EXPIRED', exact: false }], minimumMatches: 1, maximumMatches: 1 }, action: 'escalate', maxAttempts: 0 }
    ],
    variants: {
      harbor: { baseUrl: `${origin}/tenant/harbor`, locatorOverrides: {} },
      summit: { baseUrl: `${origin}/tenant/summit`, locatorOverrides: summitOverrides }
    }
  });
}
