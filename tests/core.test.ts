import { describe, expect, it } from 'vitest';
import { compileCapability } from '../src/agent/compiler.js';
import { CapabilitySchema } from '../src/core/schemas.js';
import { Guardrails, PolicyViolation } from '../src/policy/guardrails.js';
import { redactObject, redactText } from '../src/utils/redact.js';

const target = { description: 'Member field', locators: [{ strategy: 'role' as const, role: 'textbox', name: 'Member Number', exact: true }], minimumMatches: 1, maximumMatches: 1 };

function artifact() {
  return compileCapability({
    runId: 'discovery_test', entryUrl: 'http://127.0.0.1:4310/tenant/harbor', successText: 'DEPOSIT ACCOUNTS',
    actions: [
      { action: { id: 'step-01', kind: 'navigate', url: 'http://127.0.0.1:4310/tenant/harbor', risk: 'safe' } },
      { action: { id: 'step-02', kind: 'type', target, value: 'M-1001', clear: true, risk: 'safe' }, concreteValue: 'M-1001', parameterName: 'memberId' }
    ]
  });
}

describe('capability artifact', () => {
  it('is versioned, typed, and parameterized', () => {
    const capability = CapabilitySchema.parse(artifact());
    expect(capability.schemaVersion).toBe('1.0');
    expect(capability.contract.inputs.memberId?.type).toBe('string');
    expect(capability.steps[1]).toMatchObject({ kind: 'type', value: '{{memberId}}' });
  });

  it('enforces the origin allowlist before navigation', () => {
    const capability = artifact();
    const guardrails = new Guardrails(capability);
    expect(() => guardrails.assertAction({ id: 'bad', kind: 'navigate', url: 'https://attacker.example/collect', risk: 'safe' }, {}, capability.variants.harbor!.baseUrl)).toThrow(PolicyViolation);
  });
});

describe('redaction', () => {
  it('redacts identifiers, secrets, and nested values', () => {
    expect(redactText('Member M-12345 has SSN 123-45-6789')).toBe('Member [REDACTED_MEMBER_ID] has SSN [REDACTED_SSN]');
    expect(redactObject({ authorization: 'Bearer secret', nested: { member: 'M-1001' } })).toEqual({ authorization: '[REDACTED]', nested: { member: '[REDACTED_MEMBER_ID]' } });
  });
});
