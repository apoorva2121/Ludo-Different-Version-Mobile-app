'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { AccountService } = require('../server/accounts');

process.env.AUTH_SIGNING_SECRET = 'accounts-test-secret-with-at-least-32-characters-123';

test('accounts hash passwords and issue sessions', () => {
  const accounts = new AccountService();
  const created = accounts.register('Alice_Test', 'correct horse battery staple');
  assert.match(created.token, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.equal(created.username, 'alice_test');
  const loggedIn = accounts.login('ALICE_TEST', 'correct horse battery staple');
  assert.equal(loggedIn.userId, created.userId);
  assert.throws(() => accounts.login('alice_test', 'wrong password here'), { message: 'INVALID_CREDENTIALS' });
});

test('accounts reject weak credentials and duplicate usernames', () => {
  const accounts = new AccountService();
  assert.throws(() => accounts.register('ab', 'short'), { message: 'INVALID_CREDENTIALS' });
  accounts.register('unique_user', 'long enough password');
  assert.throws(() => accounts.register('UNIQUE_USER', 'another long password'), { message: 'USERNAME_UNAVAILABLE' });
});

test('SQLite accounts survive service restart', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hok-accounts-'));
  const filename = path.join(directory, 'accounts.sqlite');
  let first;
  let restarted;
  try {
    first = new AccountService({ filename });
    const created = first.register('persisted_user', 'correct horse battery staple');
    first.close();
    restarted = new AccountService({ filename });
    const loggedIn = restarted.login('persisted_user', 'correct horse battery staple');
    assert.equal(loggedIn.userId, created.userId);
  } finally {
    if (first) first.close();
    if (restarted) restarted.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
