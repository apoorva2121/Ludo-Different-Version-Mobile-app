'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.AUTH_SIGNING_SECRET = 'http-test-secret-with-at-least-32-characters-123';
process.env.ENABLE_DEV_AUTH = 'true';
process.env.NODE_ENV = 'test';

const { server } = require('../server/http');

let baseUrl;
let serverAddress;

test.before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  serverAddress = server.address();
  baseUrl = `http://127.0.0.1:${serverAddress.port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function jsonFetch(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { 'content-type': 'application/json', ...(options.headers || {}) } });
  return { response, body: await response.json() };
}

async function devToken(userId) {
  const result = await jsonFetch('/v1/auth/dev-session', { method: 'POST', body: JSON.stringify({ userId }) });
  assert.equal(result.response.status, 200);
  return result.body.token;
}

test('HTTP derives identity from the token and protects game membership', async () => {
  const aliceToken = await devToken('alice-http');
  const bobToken = await devToken('bob-http');
  const created = await jsonFetch('/v1/games', {
    method: 'POST',
    headers: { authorization: `Bearer ${aliceToken}` },
    body: JSON.stringify({ activeColors: ['red', 'green'], userId: 'bob-http' })
  });
  assert.equal(created.response.status, 400);

  const valid = await jsonFetch('/v1/games', {
    method: 'POST',
    headers: { authorization: `Bearer ${aliceToken}` },
    body: JSON.stringify({ activeColors: ['red', 'green'] })
  });
  assert.equal(valid.response.status, 201);
  const gameId = valid.body.game.id;

  const outsider = await jsonFetch(`/v1/games/${gameId}/state`, { headers: { authorization: `Bearer ${bobToken}` } });
  assert.equal(outsider.response.status, 403);
});

test('CORS allows only the configured Android asset origin', async () => {
  const allowed = await fetch(`${baseUrl}/health`, { headers: { origin: 'https://appassets.androidplatform.net' } });
  assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://appassets.androidplatform.net');
  const blocked = await fetch(`${baseUrl}/health`, { headers: { origin: 'https://evil.example' } });
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);
});

test('the local server serves the complete app but not server source or data', async () => {
  const page=await fetch(baseUrl+'/');
  assert.equal(page.status,200);
  assert.match(await page.text(),/app-shell.js/);
  for(const asset of ['online-ui.js','app-shell.js','app.css','fonts/Outfit.ttf']) assert.equal((await fetch(baseUrl+'/'+asset)).status,200);
  assert.notEqual((await fetch(baseUrl+'/server/auth.js')).status,200);
  assert.notEqual((await fetch(baseUrl+'/data/local-signing-secret')).status,200);
});

test('HTTP account registration and login issue authenticated sessions', async () => {
  const registered = await jsonFetch('/v1/auth/register', { method: 'POST', body: JSON.stringify({ username: 'http_account', password: 'correct horse battery staple' }) });
  assert.equal(registered.response.status, 200);
  assert.equal(registered.body.user.username, 'http_account');
  const loggedIn = await jsonFetch('/v1/auth/login', { method: 'POST', body: JSON.stringify({ username: 'HTTP_ACCOUNT', password: 'correct horse battery staple' }) });
  assert.equal(loggedIn.response.status, 200);
  assert.notEqual(loggedIn.body.token, registered.body.token);
  const wrong = await jsonFetch('/v1/auth/login', { method: 'POST', body: JSON.stringify({ username: 'http_account', password: 'wrong password here' }) });
  assert.equal(wrong.response.status, 401);
});
