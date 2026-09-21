import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { attachWebSocket } from '../server/ws.js';
import { maxDamageFor } from '../server/server.js';
import { WEAPONS } from '../src/game/weapons.js';

/**
 * Spin up a throwaway server, run `fn(port)`, then tear everything down.
 * Upgraded sockets survive `server.close()`, so they are destroyed by hand —
 * otherwise the test process never exits.
 */
async function withServer(onConnection, fn) {
  const sockets = new Set();
  const server = http.createServer();
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  attachWebSocket(server, onConnection);
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    return await fn(server.address().port);
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise((r) => server.close(r));
  }
}

const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(new Error(`timed out: ${label}`)), ms)),
  ]);

// RFC 6455 §1.3 worked example. Getting this constant wrong makes every
// browser refuse the handshake, so it is pinned here.
test('handshake accept value matches the RFC 6455 vector', async () => {
  const headers = await withServer(() => {}, (port) =>
    withTimeout(new Promise((resolve, reject) => {
      const req = http.request({
        port, host: '127.0.0.1', path: '/',
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          'Sec-WebSocket-Key': 'dGhlIHNhbXBsZSBub25jZQ==',
          'Sec-WebSocket-Version': '13',
        },
      });
      req.on('upgrade', (res) => resolve(res.headers));
      req.on('error', reject);
      req.end();
    }), 5000, 'handshake'));

  assert.equal(headers['sec-websocket-accept'], 's3pPLMBiTxaQ9kYGzzhZRbK+xOo=');
  assert.equal(headers.upgrade, 'websocket');
});

test('a browser WebSocket can connect, send and receive', async () => {
  const received = [];
  const reply = await withServer(
    (conn) => conn.on('message', (text) => {
      received.push(text);
      conn.sendJson({ t: 'echo', got: JSON.parse(text) });
    }),
    (port) => withTimeout(new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', name: 'TEST' }));
      ws.onmessage = (e) => { resolve(JSON.parse(e.data)); ws.close(); };
      ws.onerror = () => reject(new Error('websocket error'));
    }), 5000, 'echo'),
  );

  assert.equal(reply.t, 'echo');
  assert.equal(reply.got.name, 'TEST');
  assert.equal(received.length, 1);
});

test('payloads above 125 bytes round-trip (extended length path)', async () => {
  const big = JSON.stringify({ t: 'state', pad: 'x'.repeat(9000) });
  const echoed = await withServer(
    (conn) => conn.on('message', (text) => conn.send(text)),
    (port) => withTimeout(new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      ws.onopen = () => ws.send(big);
      ws.onmessage = (e) => { resolve(e.data); ws.close(); };
      ws.onerror = () => reject(new Error('websocket error'));
    }), 5000, 'big payload'),
  );

  assert.equal(echoed.length, big.length);
  assert.equal(JSON.parse(echoed).pad.length, 9000);
});

test('several messages in flight all arrive, in order', async () => {
  const got = await withServer(
    (conn) => conn.on('message', (t) => conn.send(t)),
    (port) => withTimeout(new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/`);
      const out = [];
      ws.onopen = () => { for (let i = 0; i < 40; i++) ws.send(`msg-${i}`); };
      ws.onmessage = (e) => {
        out.push(e.data);
        if (out.length === 40) { resolve(out); ws.close(); }
      };
      ws.onerror = () => reject(new Error('websocket error'));
    }), 5000, 'burst'),
  );

  assert.equal(got.length, 40);
  assert.equal(got[0], 'msg-0');
  assert.equal(got[39], 'msg-39');
});

test('a non-websocket request is rejected rather than hanging', async () => {
  const status = await withServer(() => {}, (port) =>
    withTimeout(new Promise((resolve, reject) => {
      const req = http.request({
        port, host: '127.0.0.1', path: '/',
        headers: { Connection: 'Upgrade', Upgrade: 'h2c' },
      });
      req.on('response', (res) => { res.resume(); resolve(res.statusCode); });
      req.on('upgrade', () => resolve('upgraded'));
      req.on('error', () => resolve('closed'));
      req.end();
    }), 5000, 'bad upgrade'));

  assert.notEqual(status, 'upgraded', 'a non-websocket upgrade must not be accepted');
});

test('reported damage is clamped to what the weapon can actually do', () => {
  assert.ok(maxDamageFor('rifle') < WEAPONS.rifle.damage * 2);
  assert.ok(maxDamageFor('rifle') >= WEAPONS.rifle.damage);
  assert.ok(maxDamageFor('rocket') >= WEAPONS.rocket.explosive.damage);
  assert.ok(maxDamageFor('totally-made-up') <= 60, 'unknown weapons must not get a free pass');
});
