export function validateConfig(env: Record<string, unknown>) {
  const required = (name: string): string => {
    const value = env[name];
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
  };
  const port = (name: string, fallback: number): number => {
    const value = env[name] ?? fallback;
    if (!/^\d+$/.test(String(value))) throw new Error(`Invalid port: ${name}`);
    const number = Number(value);
    if (number < 1 || number > 65535) throw new Error(`Invalid port: ${name}`);
    return number;
  };
  const bindHost = env.BIND_HOST ?? '0.0.0.0';
  if (!['0.0.0.0', '127.0.0.1', '::1'].includes(String(bindHost))) throw new Error('Invalid BIND_HOST');
  const trustProxy = env.TRUST_LOOPBACK_PROXY ?? 'false';
  if (!['true', 'false'].includes(String(trustProxy))) throw new Error('Invalid TRUST_LOOPBACK_PROXY');
  return {
    ...env,
    BIND_HOST: String(bindHost),
    TRUST_LOOPBACK_PROXY: trustProxy === 'true',
    PORT: port('PORT', 3000),
    DB_PORT: port('DB_PORT', 3306),
    DB_HOST: required('DB_HOST'),
    DB_NAME: required('DB_NAME'),
    DB_USER: required('DB_USER'),
    DB_PASSWORD: required('DB_PASSWORD'),
  };
}
