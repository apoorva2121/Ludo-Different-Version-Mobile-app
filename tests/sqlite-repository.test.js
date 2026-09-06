'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SqliteRepository } = require('../server/repository');
const { GameService } = require('../server/game-service');

let tempDirectory;
let databasePath;
let repository;

test.before(() => {
  tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'house-of-kiran-'));
  databasePath = path.join(tempDirectory, 'game.sqlite');
  repository = new SqliteRepository(databasePath);
});

test.after(() => {
  repository.db.close();
  fs.rmSync(tempDirectory, { recursive: true, force: true });
});

test('SQLite repository restores game state and idempotent commands after service restart', () => {
  const first = new GameService({ repository });
  const created = first.createGame({ userId: 'sqlite-alice', activeColors: ['red', 'green'] });
  first.joinGame({ gameId: created.id, userId: 'sqlite-bob', color: 'green' });
  const result = first.command({ gameId: created.id, userId: 'sqlite-alice', command: 'ROLL_DICE', commandId: 'sqlite-roll-1', expectedVersion: 0 });

  const reopened = new GameService({ repository: new SqliteRepository(databasePath) });
  const restored = reopened.getState({ gameId: created.id, userId: 'sqlite-alice' });
  assert.equal(restored.state.version, 1);
  const replay = reopened.command({ gameId: created.id, userId: 'sqlite-alice', command: 'ROLL_DICE', commandId: 'sqlite-roll-1', expectedVersion: 0 });
  assert.deepEqual(replay, result);
  reopened.repository.db.close();
});
