import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
export const serverRoot = fileURLToPath(new URL('../', import.meta.url));

export function validateContent(data) {
 const record = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected content object');
  if ('id' in value) throw new Error('Use sourceKey for imports; numeric IDs belong to the database');
 };
 const key = (value, seen) => {
  if (typeof value !== 'string' || !/^[a-z0-9-]{1,80}$/.test(value) || seen.has(value)) throw new Error('Invalid or duplicate sourceKey within parent');
  seen.add(value);
 };
 const text = (value, max) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('Missing or oversized text');
 };
 const order = (value, seen) => {
  if (!Number.isInteger(value) || value < 1 || value > 4294967295 || seen.has(value)) throw new Error('Invalid or duplicate order');
  seen.add(value);
 };
 const status = (value = 0) => {
  if (value !== 0 && value !== 1) throw new Error('Publish status must be 0 (draft) or 1 (published)');
  return value;
 };
 const url = (value = null) => {
  if (value === null) return null;
  if (typeof value !== 'string' || value.length > 512) throw new Error('Invalid source URL');
  let parsed;
  try { parsed = new URL(value); } catch { throw new Error('Invalid source URL'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw new Error('Source URL must be HTTPS without credentials');
  return value;
 };
 record(data); key(data.sourceKey, new Set()); text(data.title, 160); text(data.description, 2000);
 if (!Array.isArray(data.episodes) || !data.episodes.length) throw new Error('Empty collection');
 const episodeKeys = new Set(), episodeOrder = new Set();
 order(data.sortOrder ?? 1, new Set());
 return {
  ...data, status: status(data.status), sourceUrl: url(data.sourceUrl), sortOrder: data.sortOrder ?? 1,
  episodes: data.episodes.map(e => {
   record(e); key(e.sourceKey, episodeKeys); text(e.title, 160); order(e.sequence, episodeOrder);
   if (!Array.isArray(e.sentences) || !e.sentences.length || e.sentences.length > 200) throw new Error('Invalid sentence count');
   const sentenceKeys = new Set(), sentenceOrder = new Set();
   return { ...e, status: status(e.status), sourceUrl: url(e.sourceUrl), sentences: e.sentences.map(s => {
    record(s); key(s.sourceKey, sentenceKeys); order(s.sequence, sentenceOrder); text(s.zh, 4000); text(s.en, 8000);
    if (typeof s.context !== 'string' || s.context.length > 500) throw new Error('Invalid context');
    return { ...s };
   }) };
  }),
 };
}
export async function content() {
 return validateContent(JSON.parse(await readFile(serverRoot + 'content/daily-200.json', 'utf8')));
}
export async function connect() {
 try { process.loadEnvFile(serverRoot + '.env'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
 for (const name of ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD']) if (!process.env[name]) throw new Error('Missing ' + name);
 if (process.env.DB_NAME !== 'ytc-tool') throw new Error('This CLI only operates on the ytc-tool development database');
 const db = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306), database: process.env.DB_NAME,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, connectTimeout: 8000,
  multipleStatements: false, supportBigNumbers: true, bigNumberStrings: true, timezone: 'Z',
 });
 try { await db.query("SET time_zone = '+00:00'"); }
 catch (error) { await db.end(); throw error; }
 return db;
}
export function report(error) {
 console.error(error.code || (error instanceof Error ? error.message : 'Operation failed'));
 process.exitCode = 1;
}
