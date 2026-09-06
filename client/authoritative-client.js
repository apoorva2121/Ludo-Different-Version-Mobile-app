'use strict';

// Presentation-layer transport adapter. It never accepts a client-computed
// game state and never writes authoritative state to browser storage.

class AuthoritativeClient {
  constructor({ baseUrl, tokenProvider, fetchImpl = globalThis.fetch, timeoutMs = 10_000 } = {}) {
    if (!baseUrl || typeof tokenProvider !== 'function' || typeof fetchImpl !== 'function') throw new Error('INVALID_CLIENT_CONFIG');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.tokenProvider = tokenProvider;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.snapshot = null;
    this.listeners = new Set();
  }

  onState(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState() {
    return this.snapshot;
  }

  async createGame(options = {}) {
    return this.request('/v1/games', { method: 'POST', body: options });
  }

  async joinGame(gameId, color) {
    return this.request(`/v1/games/${encodeURIComponent(gameId)}/join`, { method: 'POST', body: color ? { color } : {} });
  }

  async synchronize(gameId) {
    return this.request(`/v1/games/${encodeURIComponent(gameId)}/state`, { method: 'GET' });
  }

  async command(gameId, command, input = {}) {
    const expectedVersion = this.snapshot && this.snapshot.state ? this.snapshot.state.version : undefined;
    const payload = { ...input, command, commandId: input.commandId || this.newCommandId(), expectedVersion };
    return this.request(`/v1/games/${encodeURIComponent(gameId)}/commands`, { method: 'POST', body: payload });
  }

  async request(path, { method, body } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const token = await this.tokenProvider();
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: { accept: 'application/json', authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data && data.error ? data.error : 'REQUEST_FAILED');
      const game = data && (data.game || (data.game === undefined && data.state ? data : null));
      if (game && game.state && Number.isInteger(game.state.version)) this.acceptSnapshot(game);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  acceptSnapshot(game) {
    if (!game || !game.state || !Number.isInteger(game.state.version)) throw new Error('INVALID_SERVER_STATE');
    if (this.snapshot && game.state.version < this.snapshot.state.version) throw new Error('STALE_SERVER_STATE');
    this.snapshot = game;
    for (const listener of this.listeners) listener(this.snapshot);
  }

  newCommandId() {
    if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') return globalThis.crypto.randomUUID();
    throw new Error('SECURE_RANDOM_UUID_UNAVAILABLE');
  }
}

module.exports = { AuthoritativeClient };

