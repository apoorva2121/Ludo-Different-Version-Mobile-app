'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { issueSession } = require('./auth');

const USERNAME = /^[a-zA-Z0-9][a-zA-Z0-9_.-]{2,39}$/;
const MIN_PASSWORD_LENGTH = 12;

function validateCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME.test(username)) throw new Error('INVALID_CREDENTIALS');
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH || password.length > 256) throw new Error('INVALID_CREDENTIALS');
  return { username: username.toLowerCase(), password };
}

function derive(password, salt) {
  return crypto.scryptSync(password, salt, 32, { N: 16_384, r: 8, p: 1 });
}

class AccountService {
  constructor({ filename = null } = {}) {
    this.accounts = new Map();
    this.db = null;
    if (filename) {
      const directory = path.dirname(path.resolve(filename));
      fs.mkdirSync(directory, { recursive: true });
      this.db = new DatabaseSync(filename);
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          user_id TEXT PRIMARY KEY,
          username TEXT NOT NULL UNIQUE,
          password_salt TEXT NOT NULL,
          password_hash TEXT NOT NULL,
          created_at TEXT NOT NULL
        );
      `);
      this.select = this.db.prepare('SELECT user_id, username, password_salt, password_hash FROM accounts WHERE username = ?');
      this.insert = this.db.prepare('INSERT INTO accounts (user_id, username, password_salt, password_hash, created_at) VALUES (?, ?, ?, ?, ?)');
    }
  }

  register(username, password) {
    const credentials = validateCredentials(username, password);
    if (this.find(credentials.username)) throw new Error('USERNAME_UNAVAILABLE');
    const userId = crypto.randomUUID();
    const salt = crypto.randomBytes(16);
    const hash = derive(credentials.password, salt);
    if (this.db) {
      try {
        this.insert.run(userId, credentials.username, salt.toString('base64url'), hash.toString('base64url'), new Date().toISOString());
      } catch (error) {
        if (String(error.code || '').includes('CONSTRAINT')) throw new Error('USERNAME_UNAVAILABLE');
        throw error;
      }
    } else this.accounts.set(credentials.username, { userId, username: credentials.username, salt, hash });
    return { userId, username: credentials.username, token: issueSession(userId) };
  }

  login(username, password) {
    const credentials = validateCredentials(username, password);
    const account = this.find(credentials.username);
    if (!account) throw new Error('INVALID_CREDENTIALS');
    const supplied = derive(credentials.password, account.salt);
    if (supplied.length !== account.hash.length || !crypto.timingSafeEqual(supplied, account.hash)) throw new Error('INVALID_CREDENTIALS');
    return { userId: account.userId, username: account.username, token: issueSession(account.userId) };
  }

  find(username) {
    if (this.db) {
      const row = this.select.get(username);
      if (!row) return null;
      return { userId: row.user_id, username: row.username, salt: Buffer.from(row.password_salt, 'base64url'), hash: Buffer.from(row.password_hash, 'base64url') };
    }
    return this.accounts.get(username) || null;
  }

  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

module.exports = { AccountService, MIN_PASSWORD_LENGTH };
