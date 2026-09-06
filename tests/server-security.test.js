'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { GameService } = require('../server/game-service');

function createReadyGame() {
  const service = new GameService();
  const game = service.createGame({ userId: 'alice', activeColors: ['red', 'green'] });
  service.joinGame({ gameId: game.id, userId: 'bob', color: 'green' });
  return { service, gameId: game.id };
}

test('a non-member cannot read another game', () => {
  const { service, gameId } = createReadyGame();
  assert.throws(() => service.getState({ gameId, userId: 'mallory' }), /FORBIDDEN/);
});

test('a member cannot act out of turn or with a stale version', () => {
  const { service, gameId } = createReadyGame();
  assert.throws(() => service.command({ gameId, userId: 'bob', command: 'ROLL_DICE', commandId: 'out-turn-1', expectedVersion: 0 }), /NOT_YOUR_TURN/);
  assert.throws(() => service.command({ gameId, userId: 'alice', command: 'ROLL_DICE', commandId: 'stale-001', expectedVersion: 99 }), /STATE_VERSION_CONFLICT/);
});

test('duplicate command IDs return the original result and do not roll twice', () => {
  const { service, gameId } = createReadyGame();
  const first = service.command({ gameId, userId: 'alice', command: 'ROLL_DICE', commandId: 'roll-once', expectedVersion: 0 });
  const second = service.command({ gameId, userId: 'alice', command: 'ROLL_DICE', commandId: 'roll-once', expectedVersion: 0 });
  assert.deepEqual(second, first);
  assert.equal(first.game.state.version, 1);
});

test('a command ID cannot be reused by another player', () => {
  const { service, gameId } = createReadyGame();
  service.command({ gameId, userId: 'alice', command: 'ROLL_DICE', commandId: 'shared-id', expectedVersion: 0 });
  assert.throws(() => service.command({ gameId, userId: 'bob', command: 'REQUEST_STATE', commandId: 'shared-id', expectedVersion: 1 }), /COMMAND_ID_REUSED/);
});

test('move commands cannot inject a destination or move another color', () => {
  const { service, gameId } = createReadyGame();
  const rolled = service.command({ gameId, userId: 'alice', command: 'ROLL_DICE', commandId: 'roll-legal', expectedVersion: 0 });
  assert.throws(() => service.command({ gameId, userId: 'alice', command: 'MOVE_PIECE', commandId: 'move-forge', expectedVersion: rolled.game.state.version, pieceId: 'green0', kind: 'single', newPosition: 25 }), /PIECE_NOT_OWNED/);
});

test('command request data cannot override the authenticated actor', () => {
  const { service, gameId } = createReadyGame();
  assert.throws(() => service.command({ gameId, userId: 'bob', command: 'ROLL_DICE', commandId: 'identity-1', expectedVersion: 0, actorUserId: 'alice' }), /NOT_YOUR_TURN/);
});
