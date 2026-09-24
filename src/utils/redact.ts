const SECRET_KEYS = /password|secret|token|api[-_]?key|authorization|cookie/i;
const MEMBER_ID = /\bM-\d{4,}\b/g;
const SSN = /\b\d{3}-\d{2}-\d{4}\b/g;

export function redactText(value: string): string {
  return value.replace(SSN, '[REDACTED_SSN]').replace(MEMBER_ID, '[REDACTED_MEMBER_ID]');
}

export function redactObject(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactObject);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, SECRET_KEYS.test(key) ? '[REDACTED]' : redactObject(item)]));
  }
  return typeof value === 'string' ? redactText(value) : value;
}
