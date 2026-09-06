'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const WebSocket = require('ws');
const { issueSession } = require('../server/auth');
const { GameService } = require('../server/game-service');
const { attachRealtime } = require('../server/realtime');

process.env.AUTH_SIGNING_SECRET = 'realtime-test-secret-with-at-least-32-characters';

let server;
let service;
let url;

test.before(async () => {
  service = new GameService();
  server = http.createServer();
  attachRealtime(server, service);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `ws://127.0.0.1:${server.address().port}/v1/realtime`;
});

test.after(async () => {
  await new Promise((resolve) => server.close(() => resolve()));
});

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const onMessage = (raw) => { cleanup(); resolve(JSON.parse(raw.toString('utf8'))); };
    const onError = (error) => { cleanup(); reject(error); };
    const cleanup = () => { socket.off('message', onMessage); socket.off('error', onError); };
    socket.on('message', onMessage);
    socket.on('error', onError);
  });
}

test('WebSocket authenticates before subscription and returns authoritative command results', async () => {
  const created = service.createGame({ userId: 'alice-ws', activeColors: ['red', 'green'] });
  service.joinGame({ gameId: created.id, userId: 'bob-ws', color: 'green' });
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.send(JSON.stringify({ type: 'AUTH', token: issueSession('alice-ws') }));
  assert.equal((await nextMessage(socket)).type, 'AUTHENTICATED');
  socket.send(JSON.stringify({ type: 'SUBSCRIBE', gameId: created.id }));
  const subscribed = await nextMessage(socket);
  assert.equal(subscribed.type, 'GAME_STATE');
  assert.equal(subscribed.game.state.version, 0);
  socket.send(JSON.stringify({ type: 'COMMAND', gameId: created.id, command: 'ROLL_DICE', commandId: 'ws-roll-01', expectedVersion: 0 }));
  const result = await nextMessage(socket);
  assert.equal(result.type, 'COMMAND_RESULT');
  assert.equal(result.commandId, 'ws-roll-01');
  assert.equal(result.game.state.version, 1);
  socket.close();
});

test('rejected commands carry their command ID so the client can recover', async () => {
  const created = service.createGame({ userId: 'error-ws', activeColors: ['red', 'green'] });
  const socket = new WebSocket(url);
  try {
    await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    socket.send(JSON.stringify({ type: 'AUTH', token: issueSession('error-ws') }));
    await nextMessage(socket);
    socket.send(JSON.stringify({ type: 'SUBSCRIBE', gameId: created.id }));
    await nextMessage(socket);
    socket.send(JSON.stringify({ type: 'COMMAND', gameId: created.id, command: 'ROLL_DICE', commandId: 'waiting-room', expectedVersion: 0 }));
    const error = await nextMessage(socket);
    assert.equal(error.error, 'GAME_WAITING_FOR_PLAYERS');
    assert.equal(error.commandId, 'waiting-room');
    const update = nextMessage(socket);
    service.joinGame({ gameId: created.id, userId: 'new-ws', color: 'green' });
    assert.equal((await update).game.players.length, 2);
  } finally { socket.close(); }
});

test('authorized subscribers receive updates from another player command', async () => {
  const created = service.createGame({ userId: 'alice-fanout', activeColors: ['red', 'green'] });
  service.joinGame({ gameId: created.id, userId: 'bob-fanout', color: 'green' });
  const alice = new WebSocket(url);
  const bob = new WebSocket(url);
  await Promise.all([alice, bob].map((socket) => new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); })));
  alice.send(JSON.stringify({ type: 'AUTH', token: issueSession('alice-fanout') }));
  bob.send(JSON.stringify({ type: 'AUTH', token: issueSession('bob-fanout') }));
  assert.equal((await nextMessage(alice)).type, 'AUTHENTICATED');
  assert.equal((await nextMessage(bob)).type, 'AUTHENTICATED');
  alice.send(JSON.stringify({ type: 'SUBSCRIBE', gameId: created.id }));
  bob.send(JSON.stringify({ type: 'SUBSCRIBE', gameId: created.id }));
  await Promise.all([nextMessage(alice), nextMessage(bob)]);
  alice.send(JSON.stringify({ type: 'COMMAND', gameId: created.id, command: 'ROLL_DICE', commandId: 'fanout-01', expectedVersion: 0 }));
  const [aliceResult, bobUpdate] = await Promise.all([nextMessage(alice), nextMessage(bob)]);
  assert.equal(aliceResult.type, 'COMMAND_RESULT');
  assert.equal(bobUpdate.type, 'GAME_STATE_UPDATED');
  assert.equal(bobUpdate.game.state.version, 1);
  alice.close();
  bob.close();
});
