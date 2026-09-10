import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateConfig } from '../src/config';

const env = { DB_HOST: 'localhost', DB_NAME: 'test', DB_USER: 'test', DB_PASSWORD: 'test-only' };
test('validates ports and keeps password unchanged', () => {
  const config = validateConfig({ ...env, DB_PASSWORD: ' space ', DB_PORT: '3307' });
  assert.equal(config.DB_PORT, 3307);
  assert.equal(config.PORT, 3000);
  assert.equal(config.DB_PASSWORD, ' space ');
});
test('rejects missing credentials without exposing values', () => {
  assert.throws(() => validateConfig({ ...env, DB_PASSWORD: '' }), /DB_PASSWORD/);
});
test('rejects malformed and out-of-range ports', () => {
  for (const value of ['0', '65536', '3000junk', '', '-1', '1.5']) {
    assert.throws(() => validateConfig({ ...env, PORT: value }), /Invalid port/);
  }
});
