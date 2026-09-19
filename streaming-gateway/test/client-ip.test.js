import test from 'node:test';
import assert from 'node:assert/strict';
import { createClientIpResolver } from '../client-ip.js';

const req = (peer, header, ip = '203.0.113.2') => ({ socket: { remoteAddress: peer }, headers: { 'cf-connecting-ip': header }, ip });
test('Cloudflare header only overrides the IP through a configured trusted peer', () => {
  const resolve = createClientIpResolver(['loopback']);
  assert.equal(resolve(req('127.0.0.1', '203.0.113.1')), '203.0.113.1');
  assert.equal(resolve(req('198.51.100.1', '203.0.113.1')), '203.0.113.2');
  assert.equal(createClientIpResolver()(req('127.0.0.1', '203.0.113.1')), '203.0.113.2');
  assert.throws(() => resolve(req('127.0.0.1', 'invalid')));
  assert.equal(resolve(req('127.0.0.1', '::ffff:203.0.113.1')), '203.0.113.1');
});
