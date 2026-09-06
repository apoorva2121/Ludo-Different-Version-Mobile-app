'use strict';

const { WebSocketServer } = require('ws');
const { authenticateRequest } = require('./auth');
const { RateLimiter } = require('./rate-limit');

const MAX_MESSAGE_BYTES = 16 * 1024;

function send(socket, payload) {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

function reject(socket, code, commandId) {
  send(socket, { type: 'ERROR', error: code, commandId, message: 'Request rejected.' });
}

function parseAuthMessage(message) {
  if (!message || message.type !== 'AUTH' || typeof message.token !== 'string' || message.token.length > 4096) return null;
  return authenticateRequest({ headers: { authorization: `Bearer ${message.token}` } });
}

function validateMessageFields(message, allowed) {
  if (!message || typeof message !== 'object' || Array.isArray(message) || Object.keys(message).some((key) => !allowed.includes(key))) throw new Error('INVALID_EVENT');
}

function attachRealtime(server, service) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
  const limiter = new RateLimiter({ windowMs: 60_000, max: 120 });
  const subscriptions = new Map();

  function subscribe(gameId, socket) {
    if (!subscriptions.has(gameId)) subscriptions.set(gameId, new Set());
    subscriptions.get(gameId).add(socket);
  }

  function unsubscribe(gameId, socket) {
    const members = subscriptions.get(gameId);
    if (!members) return;
    members.delete(socket);
    if (!members.size) subscriptions.delete(gameId);
  }

  function broadcast(gameId, payload) {
    for (const socket of subscriptions.get(gameId) || []) send(socket, payload);
  }

  const publish = gameId => {
    for (const socket of subscriptions.get(gameId) || []) {
      try { send(socket, { type: 'GAME_STATE_UPDATED', game: service.getState({ gameId, userId: socket.userId }) }); }
      catch (_) { socket.close(4003, 'membership changed'); }
    }
  };
  service.on('updated', publish);
  const heartbeat = setInterval(() => {
    for (const socket of wss.clients) {
      if (socket.alive === false) { socket.terminate(); continue; }
      socket.alive = false;
      socket.ping();
    }
    limiter.prune();
  }, 30000);
  heartbeat.unref();
  wss.on('close', () => { clearInterval(heartbeat); service.off('updated', publish); });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname !== '/v1/realtime') {
      socket.destroy();
      return;
    }
    const origin = request.headers.origin;
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'https://appassets.androidplatform.net').split(',').map((item) => item.trim()).filter(Boolean);
    if (origin && !(allowedOrigins.includes(origin) || (origin === 'null' && process.env.ALLOW_NULL_ORIGIN === 'true'))) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request));
  });

  wss.on('connection', (socket, request) => {
    socket.alive = true;
    socket.on('pong', () => { socket.alive = true; });
    socket.on('error', () => socket.terminate());
    const state = { identity: null, gameId: null, authTimer: setTimeout(() => socket.close(4001, 'authentication required'), 5_000) };
    const clientKey = request.socket.remoteAddress || 'unknown';
    socket.on('close', () => {
      clearTimeout(state.authTimer);
      clearTimeout(state.expiryTimer);
      if (state.gameId) unsubscribe(state.gameId, socket);
    });
    socket.on('message', (raw) => {
      if (!limiter.allow(`${clientKey}:ws`)) {
        reject(socket, 'RATE_LIMITED');
        return;
      }
      if (raw.length > MAX_MESSAGE_BYTES) {
        reject(socket, 'PAYLOAD_TOO_LARGE');
        socket.close(1009, 'payload too large');
        return;
      }
      let message;
      try { message = JSON.parse(raw.toString('utf8')); } catch { reject(socket, 'INVALID_JSON'); return; }
      try {
        if (!state.identity) {
          validateMessageFields(message, ['type', 'token']);
          state.identity = parseAuthMessage(message);
          if (!state.identity) { reject(socket, 'UNAUTHORIZED'); socket.close(4001, 'unauthorized'); return; }
          clearTimeout(state.authTimer);
          socket.userId = state.identity.userId;
          state.expiryTimer = setTimeout(() => socket.close(4001, 'session expired'), Math.max(0, state.identity.expiresAt * 1000 - Date.now()));
          send(socket, { type: 'AUTHENTICATED' });
          return;
        }
        if (message.type === 'SUBSCRIBE') {
          validateMessageFields(message, ['type', 'gameId']);
          if (typeof message.gameId !== 'string') throw new Error('INVALID_GAME_ID');
          const game = service.getState({ gameId: message.gameId, userId: state.identity.userId });
          if (state.gameId) unsubscribe(state.gameId, socket);
          state.gameId = message.gameId;
          subscribe(state.gameId, socket);
          send(socket, { type: 'GAME_STATE', game });
          return;
        }
        if (message.type === 'REQUEST_STATE') {
          validateMessageFields(message, ['type']);
          if (!state.gameId) throw new Error('NOT_SUBSCRIBED');
          send(socket, { type: 'GAME_STATE', game: service.getState({ gameId: state.gameId, userId: state.identity.userId }) });
          return;
        }
        if (message.type === 'COMMAND') {
          validateMessageFields(message, ['type', 'gameId', 'command', 'commandId', 'expectedVersion', 'rollIndex', 'pieceId', 'pieceIds', 'kind']);
          if (!state.gameId || message.gameId !== state.gameId) throw new Error('GAME_NOT_SUBSCRIBED');
          if (!['ROLL_DICE', 'SELECT_DIE', 'MOVE_PIECE', 'PASS_TURN', 'END_TURN'].includes(message.command)) throw new Error('INVALID_COMMAND');
          const result = service.command({
            gameId: state.gameId,
            userId: state.identity.userId,
            command: message.command,
            commandId: message.commandId,
            expectedVersion: message.expectedVersion,
            rollIndex: message.rollIndex,
            pieceId: message.pieceId,
            pieceIds: message.pieceIds,
            kind: message.kind
          });
          const game = service.runAiTurn(state.gameId);
          const update = { type: 'GAME_STATE_UPDATED', game, events: result.events };
          for (const subscriber of subscriptions.get(state.gameId) || []) {
            if (subscriber === socket) send(subscriber, { type: 'COMMAND_RESULT', ...result, game, commandId: message.commandId });
            else send(subscriber, update);
          }
          return;
        }
        throw new Error('INVALID_EVENT');
      } catch (error) {
        const safeErrors = new Set(['INVALID_GAME_ID', 'GAME_NOT_FOUND', 'FORBIDDEN', 'NOT_SUBSCRIBED', 'GAME_NOT_SUBSCRIBED', 'INVALID_COMMAND', 'INVALID_COMMAND_ID', 'STATE_VERSION_CONFLICT', 'NOT_YOUR_TURN', 'ROLL_NOT_ALLOWED', 'INVALID_ROLL_SELECTION', 'ILLEGAL_MOVE', 'INVALID_MOVE_INPUT', 'PIECE_NOT_OWNED', 'TURN_NOT_COMPLETE', 'COMMAND_ID_REUSED']);
        ['GAME_OVER', 'GAME_WAITING_FOR_PLAYERS', 'MOVE_NOT_ALLOWED'].forEach(code => safeErrors.add(code));
        reject(socket, safeErrors.has(error.message) ? error.message : 'INTERNAL_SERVER_ERROR', message && message.commandId);
      }
    });
  });
  return wss;
}

module.exports = { attachRealtime };
