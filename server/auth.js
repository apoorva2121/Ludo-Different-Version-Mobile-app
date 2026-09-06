'use strict';

const crypto = require('node:crypto');

const TOKEN_TTL_SECONDS = 60 * 60 * 24;

function secret() {
  const value = process.env.AUTH_SIGNING_SECRET;
  if (!value || value.length < 32) throw new Error('AUTH_SIGNING_SECRET must be at least 32 characters');
  return value;
}

function encode(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function sign(input) {
  return crypto.createHmac('sha256', secret()).update(input).digest('base64url');
}

function issueSession(userId, now = Math.floor(Date.now() / 1000)) {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(userId)) throw new Error('INVALID_USER_ID');
  const header = encode({ alg: 'HS256', typ: 'SESSION' });
  const payload = encode({ sub: userId, iat: now, exp: now + TOKEN_TTL_SECONDS, jti: crypto.randomUUID() });
  const unsigned = `${header}.${payload}`;
  return `${unsigned}.${sign(unsigned)}`;
}

function authenticateRequest(request) {
  const header = request.headers.authorization || '';
  const match = /^Bearer\s+([^\s]+)$/.exec(header);
  if (!match) return null;
  const parts = match[1].split('.');
  if (parts.length !== 3) return null;
  const unsigned = `${parts[0]}.${parts[1]}`;
  const expected = sign(unsigned);
  const supplied = Buffer.from(parts[2]);
  const expectedBuffer = Buffer.from(expected);
  if (supplied.length !== expectedBuffer.length || !crypto.timingSafeEqual(supplied, expectedBuffer)) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload.sub || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
    return { userId: payload.sub, sessionId: payload.jti, expiresAt: payload.exp };
  } catch {
    return null;
  }
}

module.exports = { issueSession, authenticateRequest };
