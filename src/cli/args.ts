export function parseKeyValues(values: string[]): Record<string, string> {
  return Object.fromEntries(values.map((item) => {
    const index = item.indexOf('=');
    if (index < 1) throw new Error(`Expected key=value, received: ${item}`);
    return [item.slice(0, index), item.slice(index + 1)];
  }));
}

export function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  return value === undefined ? fallback : !['false', '0', 'no'].includes(value.toLowerCase());
}
