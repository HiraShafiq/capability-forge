export function renderTemplate(value: string, inputs: Record<string, unknown>): string {
  return value.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, key: string) => {
    if (!(key in inputs)) throw new Error(`Missing template input: ${key}`);
    return String(inputs[key]);
  });
}

export function parsePrimitive(value: string, type: 'string' | 'number' | 'boolean'): string | number | boolean {
  const clean = value.trim().replace(/^\$/, '').replaceAll(',', '');
  if (type === 'number') {
    const parsed = Number(clean);
    if (!Number.isFinite(parsed)) throw new Error(`Cannot parse number from: ${value}`);
    return parsed;
  }
  if (type === 'boolean') return ['true', 'yes', '1', 'active'].includes(clean.toLowerCase());
  return value.trim();
}
