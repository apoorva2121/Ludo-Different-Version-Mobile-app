'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const engine = require('../game/engine');
const ai = require('../game/ai');
const { MemoryRepository } = require('./repository');

const MAX_PLAYERS = 4;
const COMMANDS = new Set(['ROLL_DICE', 'SELECT_DIE', 'MOVE_PIECE', 'PASS_TURN', 'END_TURN', 'REQUEST_STATE']);

function secureDie() {
  return crypto.randomInt(1, 7);
}

class GameService extends EventEmitter {
  constructor({ repository = new MemoryRepository() } = {}) {
    super();
    this.repository = repository;
  }

  createGame({ userId, activeColors = engine.COLORS, teamMode = false, mode = 'multi', aiDifficulty = {} }) {
    if (!userId || !Array.isArray(activeColors) || activeColors.length < 2 || activeColors.length > MAX_PLAYERS) throw new Error('INVALID_GAME_OPTIONS');
    if (new Set(activeColors).size !== activeColors.length || !activeColors.every((color) => engine.COLORS.includes(color))) throw new Error('INVALID_GAME_OPTIONS');
    if (typeof teamMode !== 'boolean' || !['multi', 'single'].includes(mode) || !aiDifficulty || typeof aiDifficulty !== 'object' || Array.isArray(aiDifficulty)) throw new Error('INVALID_GAME_OPTIONS');
    if (Object.entries(aiDifficulty).some(([color, profile]) => !activeColors.includes(color) || !['sprinter', 'bruiser', 'blocker', 'claude'].includes(profile))) throw new Error('INVALID_GAME_OPTIONS');
    const id = crypto.randomUUID();
    const state = engine.freshState({ activeColors, teamMode, mode, aiDifficulty });
    const players = new Map([[userId, activeColors[0]]]);
    if (mode === 'single') activeColors.slice(1).forEach((color) => players.set(`ai:${color}`, color));
    const game = { id, state, players, processedCommands: new Map(), createdAt: new Date().toISOString() };
    this.repository.createGame(game);
    return this.publicGame(game);
  }

  joinGame({ gameId, userId, color }) {
    const joined = this.repository.withTransaction(() => {
      const game = this.requireGame(gameId);
      if (game.players.has(userId)) return this.publicGame(game);
      if (game.players.size >= game.state.activeColors.length) throw new Error('GAME_FULL');
      const chosen = color || game.state.activeColors.find((item) => ![...game.players.values()].includes(item));
      if (!game.state.activeColors.includes(chosen) || [...game.players.values()].includes(chosen)) throw new Error('COLOR_UNAVAILABLE');
      game.players.set(userId, chosen);
      this.repository.saveGame(game);
      return this.publicGame(game);
    });
    this.emit('updated', gameId);
    return joined;
  }

  getState({ gameId, userId }) {
    const game = this.requireMember(gameId, userId);
    return this.publicGame(game);
  }

  command({ gameId, userId, command, commandId, expectedVersion, pieceId, pieceIds, kind, rollIndex }) {
    return this.repository.withTransaction(() => this._command({ gameId, userId, command, commandId, expectedVersion, pieceId, pieceIds, kind, rollIndex }));
  }

  _command({ gameId, userId, command, commandId, expectedVersion, pieceId, pieceIds, kind, rollIndex }) {
    if (!COMMANDS.has(command)) throw new Error('INVALID_COMMAND');
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(commandId || '')) throw new Error('INVALID_COMMAND_ID');
    const game = this.requireMember(gameId, userId);
    const fingerprint = JSON.stringify({ command, expectedVersion, pieceId, pieceIds, kind, rollIndex });
    const previous = this.repository.getCommand(game, commandId);
    if (previous) {
      if (previous.userId !== userId || previous.fingerprint !== fingerprint) throw new Error('COMMAND_ID_REUSED');
      return previous.result;
    }
    if (!Number.isInteger(expectedVersion) || expectedVersion !== game.state.version) throw new Error('STATE_VERSION_CONFLICT');

    const color = game.players.get(userId);
    const turnColor = engine.currentColor(game.state);
    const canAct = turnColor === color || (game.state.teamMode && engine.TEAM_OF[turnColor] === engine.TEAM_OF[color]);
    if (command !== 'REQUEST_STATE' && !canAct) throw new Error('NOT_YOUR_TURN');
    if (command !== 'REQUEST_STATE' && game.state.gameOver) throw new Error('GAME_OVER');
    if (command !== 'REQUEST_STATE' && game.players.size < game.state.activeColors.length) throw new Error('GAME_WAITING_FOR_PLAYERS');

    let result;
    if (command === 'REQUEST_STATE') result = { game: this.publicGame(game) };
    else if (command === 'ROLL_DICE') {
      result = engine.roll(game.state, () => (secureDie() - 1) / 6);
      if (result.error) throw new Error(result.error);
      game.state = result.state;
      engine.assertValidState(game.state);
      this.repository.saveGame(game);
      result = { game: this.publicGame(game), events: result.events, dice: result.value };
    } else if (command === 'SELECT_DIE') {
      result = engine.selectPendingRoll(game.state, rollIndex);
      if (result.error) throw new Error(result.error);
      game.state = result.state;
      engine.assertValidState(game.state);
      this.repository.saveGame(game);
      result = { game: this.publicGame(game), events: { dieSelected: true }, dice: result.value };
    } else if (command === 'MOVE_PIECE') {
      const requestedIds = Array.isArray(pieceIds) ? pieceIds : [pieceId];
      if (!requestedIds.length || requestedIds.length > 2 || !requestedIds.every((id) => typeof id === 'string') || !['single', 'stack'].includes(kind)) throw new Error('INVALID_MOVE_INPUT');
      if ((kind === 'single' && requestedIds.length !== 1) || (kind === 'stack' && requestedIds.length !== 2)) throw new Error('INVALID_MOVE_INPUT');
      const requestedPieces = requestedIds.map((id) => game.state.pieces.find((item) => item.id === id));
      if (requestedPieces.some((piece) => !piece || (piece.color !== color && !(game.state.teamMode && engine.TEAM_OF[piece.color] === engine.TEAM_OF[color])))) throw new Error('PIECE_NOT_OWNED');
      result = engine.applyMove(game.state, { pieceIds: requestedIds, kind });
      if (result.error) throw new Error(result.error);
      game.state = result.state;
      if ((game.state.killedThisTurn || game.state.finishedThisTurn)
          && !game.state.pendingRolls.some(die => engine.legalMoves(game.state, die).length)) {
        game.state = engine.resumeAfterBonus(game.state);
      }
      engine.assertValidState(game.state);
      this.repository.saveGame(game);
      result = { game: this.publicGame(game), events: result.events };
    } else if (command === 'PASS_TURN') {
      if (game.state.phase !== 'moving') throw new Error('TURN_NOT_COMPLETE');
      if (!game.state.pendingRolls.length || game.state.killedThisTurn || game.state.finishedThisTurn || game.state.pendingRolls.some((die) => engine.legalMoves(game.state, die).length)) throw new Error('TURN_NOT_COMPLETE');
      game.state = engine.endTurn(game.state);
      engine.assertValidState(game.state);
      this.repository.saveGame(game);
      result = { game: this.publicGame(game), events: { turnPassed: true } };
    } else {
      if (game.state.phase !== 'moving') throw new Error('TURN_NOT_COMPLETE');
      if (game.state.pendingRolls.length || game.state.killedThisTurn || game.state.finishedThisTurn) throw new Error('TURN_NOT_COMPLETE');
      game.state = engine.endTurn(game.state);
      engine.assertValidState(game.state);
      this.repository.saveGame(game);
      result = { game: this.publicGame(game), events: { turnEnded: true } };
    }
    this.repository.saveCommand(game, commandId, { userId, fingerprint, result });
    this.repository.pruneCommands(game);
    return result;
  }

  runAiTurn(gameId, maxActions = 100) {
    let actions = 0;
    while (actions < maxActions) {
      const game = this.requireGame(gameId);
      if (game.state.gameOver) break;
      const color = engine.currentColor(game.state);
      const aiUserId = `ai:${color}`;
      if (!game.players.has(aiUserId)) break;
      const expectedVersion = game.state.version;
      const commandId = `ai-${crypto.randomUUID()}`;
      if (game.state.phase === 'rolling' && game.state.canRoll) {
        this.command({ gameId, userId: aiUserId, command: 'ROLL_DICE', commandId, expectedVersion });
      } else if (game.state.phase === 'moving') {
        const decision = ai.chooseMove(game.state, game.state.aiDifficulty[color] || 'claude');
        if (decision) {
          let moveVersion = expectedVersion;
          if (decision.rollIndex !== game.state.selectedRollIndex || game.state.dice !== game.state.pendingRolls[decision.rollIndex]) {
            this.command({ gameId, userId: aiUserId, command: 'SELECT_DIE', commandId: `${commandId}-select`, expectedVersion: moveVersion, rollIndex: decision.rollIndex });
            moveVersion += 1;
          }
          this.command({ gameId, userId: aiUserId, command: 'MOVE_PIECE', commandId, expectedVersion: moveVersion, pieceIds: decision.move.pieceIds, kind: decision.move.kind });
        } else {
          this.command({ gameId, userId: aiUserId, command: game.state.pendingRolls.length ? 'PASS_TURN' : 'END_TURN', commandId, expectedVersion });
        }
      } else {
        break;
      }
      actions += 1;
    }
    if (actions >= maxActions) throw new Error('AI_ACTION_LIMIT');
    return this.publicGame(this.requireGame(gameId));
  }

  requireGame(gameId) {
    if (typeof gameId !== 'string' || !/^[0-9a-f-]{36}$/.test(gameId)) throw new Error('INVALID_GAME_ID');
    const game = this.repository.getGame(gameId);
    if (!game) throw new Error('GAME_NOT_FOUND');
    return game;
  }

  requireMember(gameId, userId) {
    const game = this.requireGame(gameId);
    if (!game.players.has(userId)) throw new Error('FORBIDDEN');
    return game;
  }

  publicGame(game) {
    return { id: game.id, state: engine.cloneState(game.state), players: [...game.players.entries()].map(([userId, color]) => ({ userId, color })), createdAt: game.createdAt };
  }
}

module.exports = { GameService };
