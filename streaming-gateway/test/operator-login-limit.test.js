import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { registerOperatorConsole } from '../operator-console.js';
import { hashOperatorPassword, sessionDigest } from '../operator-auth.js';

test('login limits count failures only, reset on success, and still block brute force', async t => {
  const values = new Map(), expirations = [];
  const redis = { get: async key => values.get(key), set: async (key, value) => values.set(key, value),
    del: async key => values.delete(key), expire: async (key, seconds) => expirations.push([key, seconds]),
    incr: async key => { const value = Number(values.get(key) || 0) + 1; values.set(key, value); return value; } };
  const password = 'local-only-login-limit-test-password';
  const config = { api: '', operatorPasswordHash: await hashOperatorPassword(password) };
  const app = express(); app.use(express.json());
  registerOperatorConsole(app, { config, redis, clientIp: () => 'test-client', getMatches: async () => [], status: () => ({}) });
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  config.api = `http://127.0.0.1:${server.address().port}`;
  const key = `operator:login:${sessionDigest('test-client')}`;
  const login = value => fetch(config.api + '/api/operator/login', { method: 'POST',
    headers: { Origin: config.api, 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: value }) });
  for (let i = 0; i < 8; i++) assert.equal((await login(password)).status, 200);
  const pendingLogin = login(password);
  await new Promise(resolve => setTimeout(resolve, 30));
  const overlappingLogin = await login(password);
  assert.equal(overlappingLogin.status, 409);
  assert.equal((await overlappingLogin.json()).error, 'login_in_progress');
  assert.equal((await pendingLogin).status, 200);
  assert.equal(values.has(key), false);
  assert.equal(expirations.length, 0);
  for (let i = 0; i < 3; i++) assert.equal((await login('wrong')).status, 401);
  assert.equal((await login(password)).status, 200);
  assert.equal(values.has(key), false);
  for (let i = 0; i < 6; i++) assert.equal((await login('wrong')).status, 401);
  assert.equal((await login(password)).status, 429);
  assert.equal(values.get(key), 6);
  assert.deepEqual(expirations, [[key, 900], [key, 900]]);
});
