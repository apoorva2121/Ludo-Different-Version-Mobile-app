# Target Architecture

The repository now has an initial boundary between the rules engine and the transport layer:

```text
Android/web presentation client (untrusted)
       │ HTTPS + authenticated WebSocket (WSS behind TLS termination)
       ▼
server/http.js → server/auth.js → server/game-service.js
                                      │
                                      ▼
                              game/engine.js
```

The first Android packaging layer is under `android/`. It wraps the current board in a restricted WebView, passes a configured backend URL to the integrated `online-ui.js` lobby, and persists session tokens through a narrowly scoped Android Keystore bridge. `client/authoritative-client.js` remains the small REST presentation adapter; account lifecycle hardening and external identity integration are still follow-up work.

Persistence is selected with `GAME_DATABASE_PATH`: omitted uses the in-memory repository for tests, while a path enables the built-in SQLite repository for restart persistence. SQLite gameplay commands and joins use `BEGIN IMMEDIATE`; a horizontally scaled deployment still needs a reviewed shared database/locking strategy.

`game/ai.js` is the first server-side AI adapter. It evaluates only legal moves produced by `game/engine.js`; in single-player sessions the service assigns non-human colors to server-owned `ai:<color>` seats and can advance those turns without accepting client AI decisions.

`game/engine.js` is transport- and DOM-independent. It owns board math, occupancy, legal move generation, move application, dice state transitions, turn changes, and finish detection. The current backend service is an in-memory development implementation with opaque signed sessions, membership checks, state-version checks, server-side randomness, and command idempotency.

The next production steps are a real account/identity provider, durable event/state history and reconnect replay, and replacing the development-only guest session flow. The preserved HTML now has an online bridge that maps snapshots into the existing renderer; its local/tutorial/developer modes remain intact.
