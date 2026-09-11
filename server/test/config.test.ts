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

test('deployment binds locally and enables only explicit loopback proxy trust',()=>{
 const local=validateConfig(env);assert.equal(local.BIND_HOST,'0.0.0.0');assert.equal(local.TRUST_LOOPBACK_PROXY,false);
 const production=validateConfig({...env,BIND_HOST:'127.0.0.1',TRUST_LOOPBACK_PROXY:'true'});
 assert.equal(production.BIND_HOST,'127.0.0.1');assert.equal(production.TRUST_LOOPBACK_PROXY,true);
 assert.throws(()=>validateConfig({...env,BIND_HOST:'invalid'}),/BIND_HOST/);
 assert.throws(()=>validateConfig({...env,TRUST_LOOPBACK_PROXY:'yes'}),/TRUST_LOOPBACK_PROXY/);
});
