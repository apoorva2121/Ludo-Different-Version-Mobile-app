'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { authenticateRequest, issueSession } = require('./auth');
const { GameService } = require('./game-service');
const { RateLimiter } = require('./rate-limit');
const { attachRealtime } = require('./realtime');
const { SqliteRepository } = require('./repository');
const { AccountService } = require('./accounts');

const service = new GameService({ repository: process.env.GAME_DATABASE_PATH ? new SqliteRepository(process.env.GAME_DATABASE_PATH) : undefined });
const accounts = new AccountService({ filename: process.env.GAME_DATABASE_PATH || null });
const maxBodyBytes = 16 * 1024;
const limiter = new RateLimiter({ windowMs: 60_000, max: 120 });
const authLimiter = new RateLimiter({ windowMs: 60_000, max: 10 });
const publicFiles = {
  '/': ['House_of_Kiran_AI_Stage3_6_PRODUCTION.html','text/html; charset=utf-8'],
  '/House_of_Kiran_AI_Stage3_6_PRODUCTION.html': ['House_of_Kiran_AI_Stage3_6_PRODUCTION.html','text/html; charset=utf-8'],
  '/online-ui.js':['online-ui.js','text/javascript; charset=utf-8'],
  '/app-shell.js':['app-shell.js','text/javascript; charset=utf-8'],
  '/app.css':['app.css','text/css; charset=utf-8'],
  '/banner-en.webp':['banner-en.webp','image/webp'],
  '/banner-hi.webp':['banner-hi.webp','image/webp'],
  '/banner-te.webp':['banner-te.webp','image/webp'],
  '/fonts/Outfit.ttf':['fonts/Outfit.ttf','font/ttf'],
  '/fonts/OFL-Outfit.txt':['fonts/OFL-Outfit.txt','text/plain; charset=utf-8']
};

function send(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer'
  });
  response.end(JSON.stringify(body));
}

function applyCors(response, request) {
  const origin = request.headers.origin;
  const configured = (process.env.ALLOWED_ORIGINS || 'https://appassets.androidplatform.net')
    .split(',').map((item) => item.trim()).filter(Boolean);
  const allowed = origin && (configured.includes(origin) || (origin === 'null' && process.env.ALLOW_NULL_ORIGIN === 'true'));
  if (!allowed) return;
  response.setHeader('access-control-allow-origin', origin);
  response.setHeader('vary', 'Origin');
  response.setHeader('access-control-allow-headers', 'authorization, content-type');
  response.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
}

function validateFields(body, allowed) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('INVALID_JSON');
  if (Object.keys(body).some((key) => !allowed.includes(key))) throw new Error('UNEXPECTED_FIELD');
  return body;
}

function readJson(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let body = '';
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > maxBodyBytes) reject(new Error('PAYLOAD_TOO_LARGE'));
      else body += chunk;
    });
    request.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new Error('INVALID_JSON')); }
    });
    request.on('error', reject);
  });
}

function requireAuth(request) {
  const identity = authenticateRequest(request);
  if (!identity) throw new Error('UNAUTHORIZED');
  return identity;
}

async function route(request, response) {
  try {
    applyCors(response, request);
    const clientKey = request.socket.remoteAddress || 'unknown';
    if (!limiter.allow(clientKey)) return send(response, 429, { error: 'RATE_LIMITED', message: 'Too many requests.' });
    if (request.url && request.url.includes('/commands') && !limiter.allow(`${clientKey}:commands`)) return send(response, 429, { error: 'RATE_LIMITED', message: 'Too many requests.' });
    const url = new URL(request.url, 'http://localhost');
    if (request.method === 'OPTIONS') return send(response, 204, {});
    if (request.method === 'GET' && url.pathname === '/health') return send(response, 200, { ok: true });
    if (request.method === 'GET' && Object.hasOwn(publicFiles,url.pathname)) {
      const [file,mime] = publicFiles[url.pathname];
      const content = await fs.readFile(path.join(__dirname,'..',file));
      response.writeHead(200,{'content-type':mime,'cache-control':'no-cache','x-content-type-options':'nosniff'});
      return response.end(content);
    }

    if (request.method === 'POST' && url.pathname === '/v1/auth/dev-session') {
      if (process.env.NODE_ENV === 'production' || process.env.ENABLE_DEV_AUTH !== 'true') throw new Error('NOT_FOUND');
      const body = validateFields(await readJson(request), ['userId']);
      return send(response, 200, { token: issueSession(body.userId) });
    }

    if (request.method === 'POST' && (url.pathname === '/v1/auth/register' || url.pathname === '/v1/auth/login')) {
      const clientKey = request.socket.remoteAddress || 'unknown';
      if (!authLimiter.allow(clientKey)) return send(response, 429, { error: 'RATE_LIMITED', message: 'Too many authentication attempts.' });
      const body = validateFields(await readJson(request), ['username', 'password']);
      const result = url.pathname.endsWith('/register') ? accounts.register(body.username, body.password) : accounts.login(body.username, body.password);
      return send(response, 200, { token: result.token, user: { id: result.userId, username: result.username } });
    }

    const identity = requireAuth(request);
    if (request.method === 'GET' && url.pathname === '/v1/auth/me') return send(response, 200, { user: { id: identity.userId } });
    if (request.method === 'POST' && url.pathname === '/v1/games') {
      const body = validateFields(await readJson(request), ['activeColors', 'teamMode', 'mode', 'aiDifficulty']);
      return send(response, 201, { game: service.createGame({
        userId: identity.userId,
        activeColors: body.activeColors,
        teamMode: body.teamMode,
        mode: body.mode,
        aiDifficulty: body.aiDifficulty
      }) });
    }
    const joinMatch = /^\/v1\/games\/([^/]+)\/join$/.exec(url.pathname);
    if (request.method === 'POST' && joinMatch) {
      const body = validateFields(await readJson(request), ['color']);
      return send(response, 200, { game: service.joinGame({ gameId: joinMatch[1], userId: identity.userId, color: body.color }) });
    }
    const stateMatch = /^\/v1\/games\/([^/]+)\/state$/.exec(url.pathname);
    if (request.method === 'GET' && stateMatch) return send(response, 200, { game: service.getState({ gameId: stateMatch[1], userId: identity.userId }) });
    const commandMatch = /^\/v1\/games\/([^/]+)\/commands$/.exec(url.pathname);
    if (request.method === 'POST' && commandMatch) {
      const body = validateFields(await readJson(request), ['command', 'commandId', 'expectedVersion', 'rollIndex', 'pieceId', 'pieceIds', 'kind']);
      const result = service.command({
        gameId: commandMatch[1],
        userId: identity.userId,
        command: body.command,
        commandId: body.commandId,
        expectedVersion: body.expectedVersion,
        rollIndex: body.rollIndex,
        pieceId: body.pieceId,
        pieceIds: body.pieceIds,
        kind: body.kind
      });
      const game = service.runAiTurn(commandMatch[1]);
      service.emit('updated', commandMatch[1]);
      return send(response, 200, { ...result, game });
    }
    throw new Error('NOT_FOUND');
  } catch (error) {
    const status = { UNAUTHORIZED: 401, FORBIDDEN: 403, NOT_FOUND: 404, GAME_NOT_FOUND: 404, GAME_FULL: 409, STATE_VERSION_CONFLICT: 409, COMMAND_ID_REUSED: 409, USERNAME_UNAVAILABLE: 409, INVALID_CREDENTIALS: 401, INVALID_JSON: 400, UNEXPECTED_FIELD: 400, INVALID_ROLL_SELECTION: 400, PAYLOAD_TOO_LARGE: 413, RATE_LIMITED: 429 }[error.message]
      || (String(error.message).startsWith('AUTH_SIGNING_SECRET') ? 500 : 400);
    if (status >= 500) console.error(JSON.stringify({ type: 'server_error', error: error.message }));
    send(response, status, { error: status >= 500 ? 'INTERNAL_SERVER_ERROR' : error.message, message: status >= 500 ? 'Something went wrong.' : 'Request rejected.' });
  }
}

setInterval(() => limiter.prune(), 60_000).unref();

const server = http.createServer(route);
if (require.main === module) {
  attachRealtime(server, service);
  server.listen(Number(process.env.PORT || 8080), process.env.HOST || '127.0.0.1');
}
module.exports = { server, service };
