'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTH_SIGNING_SECRET = 'test-secret-with-at-least-32-characters-123';
const { issueSession, authenticateRequest } = require('../server/auth');

test('signed sessions authenticate the token subject, not request data', () => {
  const token = issueSession('alice');
  const identity = authenticateRequest({ headers: { authorization: `Bearer ${token}` } });
  assert.equal(identity.userId, 'alice');
  assert.ok(identity.sessionId);
});

test('tampered and expired sessions are rejected', () => {
  const token = issueSession('alice');
  const tampered = `${token.slice(0, -1)}${token.endsWith('a') ? 'b' : 'a'}`;
  assert.equal(authenticateRequest({ headers: { authorization: `Bearer ${tampered}` } }), null);
  const expired = issueSession('alice', Math.floor(Date.now() / 1000) - (60 * 60 * 24) - 1);
  assert.equal(authenticateRequest({ headers: { authorization: `Bearer ${expired}` } }), null);
});
