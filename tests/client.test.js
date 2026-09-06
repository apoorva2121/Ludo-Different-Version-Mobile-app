'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { AuthoritativeClient } = require('../client/authoritative-client');

function fakeResponse(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

test('client commands carry intent and current server version', async () => {
  let request;
  const client = new AuthoritativeClient({
    baseUrl: 'https://api.example.test',
    tokenProvider: async () => 'opaque-token',
    fetchImpl: async (url, options) => {
      request = { url, options, body: JSON.parse(options.body) };
      return fakeResponse({ game: { state: { version: 1 } } });
    }
  });
  client.acceptSnapshot({ state: { version: 0 } });
  await client.command('game-id', 'MOVE_PIECE', { pieceId: 'red0', kind: 'single', commandId: 'command-001' });
  assert.equal(request.body.expectedVersion, 0);
  assert.equal(request.body.pieceId, 'red0');
  assert.equal('newPosition' in request.body, false);
  assert.match(request.options.headers.authorization, /^Bearer /);
});

test('client rejects a stale authoritative snapshot', () => {
  const client = new AuthoritativeClient({ baseUrl: 'https://api.example.test', tokenProvider: async () => 'token', fetchImpl: async () => fakeResponse({}) });
  client.acceptSnapshot({ state: { version: 4 } });
  assert.throws(() => client.acceptSnapshot({ state: { version: 3 } }), /STALE_SERVER_STATE/);
});
