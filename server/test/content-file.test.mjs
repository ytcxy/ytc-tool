import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../scripts/import.mjs', import.meta.url));
const run = args => spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', cwd: '/' });

test('custom content validates offline with a path relative to server, preserving the default collection', () => {
 for (const [args, episodes, sentences] of [
  [['--validate', '--file=content/forced-english-system.json'], 6, 93],
  [['--validate'], 200, 3130],
 ]) {
  const result = run(args);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { valid: true, episodes, sentences });
 }
});

test('file selection rejects ambiguity and does not bypass validation-only safeguards', () => {
 for (const args of [
  ['--validate', '--file='],
  ['--validate', '--file=a', '--file=b'],
  ['--validate', '--file=content/forced-english-system.json', '--apply'],
  ['--validate', '--file=content/forced-english-system.json', '--database=ytc-tool-prod'],
 ]) assert.equal(run(args).status, 1);
});
