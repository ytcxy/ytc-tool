import { parseEnv } from 'node:util';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
export function normalizeEnv(source) {
 const env = parseEnv(source);
 const required = ['DB_HOST','DB_NAME','DB_USER','DB_PASSWORD','WECHAT_APP_ID','WECHAT_APP_SECRET'];
 for (const key of required) if (!env[key]?.trim()) throw new Error('Missing ' + key);
 if (env.DB_NAME !== 'ytc-tool-prod') throw new Error('Deployment requires DB_NAME=ytc-tool-prod');
 const port = env.DB_PORT ?? '3306';
 if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('Invalid DB_PORT');
 env.DB_PORT = port;
 return [...required, 'DB_PORT'].map(key => {
  if (/[\r\n\0]/.test(env[key])) throw new Error('Multiline value is unsupported: ' + key);
  return key + '=' + env[key];
 }).join('\n') + '\n';
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
 try {
  if (process.argv.length !== 4) throw new Error('Usage: prepare-env.mjs INPUT OUTPUT');
  writeFileSync(process.argv[3], normalizeEnv(readFileSync(process.argv[2], 'utf8')), { mode: 0o600, flag: 'wx' });
 } catch (error) {
  console.error(error.code || error.message); process.exitCode = 1;
 }
}
