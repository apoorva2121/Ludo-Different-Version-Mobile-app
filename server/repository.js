'use strict';

const { DatabaseSync } = require('node:sqlite');
const fs = require('node:fs');
const path = require('node:path');

class MemoryRepository {
  constructor() {
    this.games = new Map();
  }

  createGame(game) { this.games.set(game.id, game); }
  getGame(id) { return this.games.get(id) || null; }
  saveGame() {}
  getCommand(game, commandId) { return game.processedCommands.get(commandId) || null; }
  saveCommand(game, commandId, value) { game.processedCommands.set(commandId, value); }
  pruneCommands(game) {
    if (game.processedCommands.size > 1000) game.processedCommands.delete(game.processedCommands.keys().next().value);
  }

  withTransaction(callback) { return callback(); }
}

class SqliteRepository {
  constructor(filename = 'house-of-kiran.sqlite') {
    const directory = path.dirname(path.resolve(filename));
    fs.mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY,
        state_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS players (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        user_id TEXT NOT NULL,
        color TEXT NOT NULL,
        PRIMARY KEY (game_id, user_id),
        UNIQUE (game_id, color)
      );
      CREATE TABLE IF NOT EXISTS commands (
        game_id TEXT NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        command_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (game_id, command_id)
      );
    `);
    this.insertGame = this.db.prepare('INSERT INTO games (id, state_json, created_at) VALUES (?, ?, ?)');
    this.selectGame = this.db.prepare('SELECT id, state_json, created_at FROM games WHERE id = ?');
    this.selectPlayers = this.db.prepare('SELECT user_id, color FROM players WHERE game_id = ? ORDER BY rowid');
    this.insertPlayer = this.db.prepare('INSERT INTO players (game_id, user_id, color) VALUES (?, ?, ?)');
    this.deletePlayers = this.db.prepare('DELETE FROM players WHERE game_id = ?');
    this.updateGame = this.db.prepare('UPDATE games SET state_json = ? WHERE id = ?');
    this.selectCommand = this.db.prepare('SELECT user_id, fingerprint, result_json FROM commands WHERE game_id = ? AND command_id = ?');
    this.insertCommand = this.db.prepare('INSERT INTO commands (game_id, command_id, user_id, fingerprint, result_json, created_at) VALUES (?, ?, ?, ?, ?, ?)');
    this.deleteOldCommands = this.db.prepare('DELETE FROM commands WHERE game_id = ? AND command_id IN (SELECT command_id FROM commands WHERE game_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET 1000)');
  }

  createGame(game) {
    this.insertGame.run(game.id, JSON.stringify(game.state), game.createdAt);
    for (const [userId, color] of game.players) this.insertPlayer.run(game.id, userId, color);
  }

  getGame(id) {
    const row = this.selectGame.get(id);
    if (!row) return null;
    const players = new Map(this.selectPlayers.all(id).map((item) => [item.user_id, item.color]));
    return { id: row.id, state: JSON.parse(row.state_json), players, processedCommands: new Map(), createdAt: row.created_at };
  }

  saveGame(game) {
    this.updateGame.run(JSON.stringify(game.state), game.id);
    this.deletePlayers.run(game.id);
    for (const [userId, color] of game.players) this.insertPlayer.run(game.id, userId, color);
  }

  getCommand(game, commandId) {
    const row = this.selectCommand.get(game.id, commandId);
    if (!row) return null;
    return { userId: row.user_id, fingerprint: row.fingerprint, result: JSON.parse(row.result_json) };
  }

  saveCommand(game, commandId, value) {
    this.insertCommand.run(game.id, commandId, value.userId, value.fingerprint, JSON.stringify(value.result), new Date().toISOString());
    this.deleteOldCommands.run(game.id, game.id);
  }

  pruneCommands() {}

  withTransaction(callback) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = callback();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      try { this.db.exec('ROLLBACK'); } catch (_) { /* preserve original failure */ }
      throw error;
    }
  }
}

module.exports = { MemoryRepository, SqliteRepository };
