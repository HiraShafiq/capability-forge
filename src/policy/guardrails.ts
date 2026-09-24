import type { Action, Capability } from '../core/schemas.js';
import { renderTemplate } from '../utils/template.js';

export class PolicyViolation extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = 'PolicyViolation';
  }
}

export class Guardrails {
  constructor(private readonly capability: Capability) {}

  assertAction(action: Action, inputs: Record<string, unknown>, currentUrl: string): void {
    if (!this.capability.policy.allowedActions.includes(action.kind)) {
      throw new PolicyViolation('ACTION_NOT_ALLOWED', `Action type ${action.kind} is not allowed`);
    }

    const targetUrl = action.kind === 'navigate' ? renderTemplate(action.url, inputs) : currentUrl;
    const parsed = new URL(targetUrl);
    if (!this.capability.policy.allowedOrigins.includes(parsed.origin)) {
      throw new PolicyViolation('ORIGIN_NOT_ALLOWED', `Origin ${parsed.origin} is outside the allowlist`);
    }
    if (!this.capability.policy.allowedPathPatterns.some((pattern) => new RegExp(pattern).test(parsed.pathname))) {
      throw new PolicyViolation('PATH_NOT_ALLOWED', `Path ${parsed.pathname} is outside the allowlist`);
    }

    if ('risk' in action && action.risk !== 'safe') {
      const handling = this.capability.policy.riskyActionHandling;
      if (handling === 'block') throw new PolicyViolation('RISKY_ACTION_BLOCKED', `${action.risk} action ${action.id} is blocked`);
      if (handling === 'confirm' || handling === 'escalate') {
        throw new PolicyViolation('HUMAN_APPROVAL_REQUIRED', `${action.risk} action ${action.id} requires human approval`);
      }
    }
  }
}
