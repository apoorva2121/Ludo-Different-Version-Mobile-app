# Architecture Audit (historical)

Date: 2026-09-06

> **This document describes the original browser-only prototype, before the extraction work.**
> It is no longer an accurate description of the codebase. Every statement below was true of
> the single-HTML-file prototype it audited, and it is preserved because it records the
> reasoning behind the architecture the project now has.
>
> For the current system, read [`ARCHITECTURE.md`](ARCHITECTURE.md).
> For what happened to each recommendation, jump to
> [What changed since this audit](#what-changed-since-this-audit) at the end.

## Executive summary

This repository is a browser-only prototype, not yet an Android or multiplayer application. It contains one self-contained HTML document, `House_of_Kiran_AI_Stage3_6_PRODUCTION.html` (3,634 lines), and three WebP banner assets. CSS, markup, translations, game state, rules, rendering, animation, sound, tutorial behavior, developer scenarios, and AI are all embedded in the same file. There is no server, database, Android project, package manifest, build system, test suite, authentication, or network protocol.

The existing implementation is valuable as a gameplay reference: it contains the board geometry, the current house rules, local pass-and-play, single-player AI, tutorial, multilingual strings, animations, and a substantial set of developer scenarios. The safest migration is to extract and test the rules/AI first, then introduce a server-authoritative application boundary, and finally wrap/preserve the presentation layer in the least disruptive Android technology.

## Current architecture

```text
Static HTML file
  ├─ CSS and responsive board UI
  ├─ setup screens, tutorial, advanced rules, developer menu
  ├─ mutable global `state`
  ├─ board coordinates and movement rules
  ├─ random dice and turn progression
  ├─ local AI decision/scoring
  ├─ DOM rendering, animation, Web Audio, vibration
  └─ localStorage tutorial flags
```

The only external runtime dependency is Google Fonts loaded from `fonts.googleapis.com`. The banners are referenced as `assets/banner-*.webp`, but the repository currently stores them at the root, so those paths should be verified/fixed during the client migration.

## Data flow

1. Setup handlers (`selectMode`, `choosePlayerCount`, color/difficulty selectors) mutate setup globals.
2. `startGame()` calls `freshState(teamMode, activeColors)` and adds mode, human color, and AI difficulty to the global state.
3. `renderAll()` rebuilds/updates the board and status from the global state.
4. A local user or AI calls `onDiceClick()`/`maybeAutoPlay()`; `handleRoll()` uses either `devForceRoll` or `Math.random()` and updates `pendingRolls`, `sixStreak`, and phase fields.
5. `computeMovable()` derives legal move candidates from state, dice, occupancy, blocking, team, safe-square, and stacking rules.
6. `performMove()` animates the piece, then `executeMove()` mutates piece positions and applies capture/stack/home effects.
7. `finishTurnOrBonus()` or `endTurn()` advances the local turn; `registerFinish()` determines rankings and game completion.
8. DOM/event callbacks and localStorage are the only persistence/communication mechanisms. No state leaves the browser.

## Important files and code regions

There is currently one source file:

- `House_of_Kiran_AI_Stage3_6_PRODUCTION.html:455-551` — board constants, coordinates, shared-square mapping, and `freshState()`.
- `House_of_Kiran_AI_Stage3_6_PRODUCTION.html:553-950` — event text, English/Hindi/Telugu strings and localization data.
- `House_of_Kiran_AI_Stage3_6_PRODUCTION.html:956-1210` — setup flow, player/color selection, AI difficulty selection, and `startGame()`.
- `House_of_Kiran_AI_Stage3_6_PRODUCTION.html:1230-1768` — developer scenarios and tutorial state machine; tutorial completion/skip flags use localStorage.
- `House_of_Kiran_AI_Stage3_6_PRODUCTION.html:1830-2205` — board construction, rendering, sound, and browser vibration.
- `House_of_Kiran_AI_Stage3_6_PRODUCTION.html:2230-2700` — occupancy, legal movement, blocking, capture, stacking/Judwa, and state mutation.
- `House_of_Kiran_AI_Stage3_6_PRODUCTION.html:2700-3058` — AI evaluation, simulation, personalities, and two-dice planning.
- `House_of_Kiran_AI_Stage3_6_PRODUCTION.html:3060-3631` — dice/turn UI, move selection, animations, turn transitions, finishing, rankings, and win overlay.

## Existing gameplay behavior to preserve

The implementation currently models:

- Four colors with entries `red=0`, `green=13`, `yellow=26`, `blue=39` and an eight-square safe set.
- Relative positions `0` (yard), `1..51` (track), `52..56` (home alley), and `57` (finished).
- Four pieces per active color and optional 2v2 teams (`red+yellow` versus `green+blue`).
- Six-based yard exits, extra rolls, three-six cancellation, bonus rolls for capture and finishing, and frozen killer behavior.
- Judwa/stack formation and movement, unstacking restrictions, blocking, stack-only kills, topping/frozen pieces, safe-square exceptions, and team movement.
- Finish order, retired colors, last-place auto-assignment, single-player AI, all-AI mode, local multiplayer, tutorial mode, advanced rules, developer scenarios, and English/Hindi/Telugu UI strings.

These rules are intertwined with DOM rendering and global mutable state, so they should be extracted with characterization tests before behavior is changed.

## What can be reused

- Board coordinate arrays and relative/global position calculations.
- `freshState()` shape as a starting point for a versioned domain state model.
- Occupancy and move-generation logic in `computeMovable()` and its helpers.
- State transition behavior in `executeMove()`, `finishTurnOrBonus()`, `endTurn()`, and `registerFinish()`.
- AI evaluation heuristics, personalities, simulation, and two-dice planning.
- Existing board CSS/visual language, WebP banners, animation timing, sound cues, tutorial steps, and translated content.
- Developer scenarios as fixtures for engine and integration tests, after removing production access.

## What needs refactoring

### Phase 1: domain extraction

Create a dependency-free game engine with explicit inputs/outputs:

```text
game-engine/
  state
  board geometry
  rules and legal moves
  command reducer (ROLL_DICE, MOVE_PIECE, ...)
  win/turn progression
  AI adapter
```

The engine must not import `document`, `window`, Web Audio, browser storage, or transport code. It should accept an injectable random source so production dice can use a server CSPRNG and tests can be deterministic.

### Phase 2: backend authority

Add a backend that owns the engine, sessions, authenticated identity, dice, turns, move validation, AI, completion, and persistence. The client should send intents such as `ROLL_DICE` and `MOVE_PIECE` with a game/session version and idempotency key; it must never submit a destination or authoritative state.

### Phase 3: client adapter

Keep the current visual design but replace direct state mutation with a presentation store driven by authoritative snapshots/events. Animation should run after accepted server events and be recoverable from a fresh state request after reconnect.

### Phase 4: Android packaging

No Android technology can be selected from this repository alone because there is no existing frontend build. The least disruptive first target is a WebView/Capacitor-style wrapper around a modularized web client if the existing DOM animations remain important. A native rewrite should only be chosen if profiling or Android requirements show that the board cannot perform reliably in a WebView.

## Security assessment

Current security posture is suitable only for local/offline play.

- **Client authority / cheating:** all game state, dice, turn checks, move validation, AI, win status, and rankings are client-controlled. A modified page can call any global function, edit `state`, set `devForceRoll`, or bypass UI checks.
- **Randomness:** gameplay dice use `Math.random()` at `onDiceClick()`; this is not suitable for authoritative or auditable server dice.
- **No identity or authorization:** there is no authentication, game ownership, multiplayer session, or access control.
- **No transport security:** there is no API/WebSocket layer, therefore no HTTPS/WSS boundary or reconnect authorization.
- **Replay/concurrency:** there are no request IDs, versions, transactions, locks, or duplicate-action protections.
- **Debug exposure:** the Developer Mode link and force-roll/scenario behavior are available in the shipped page. They must be compile-time or server-side gated and absent from production gameplay.
- **Persistence:** only tutorial flags are stored in localStorage. This is not secure storage and must not hold tokens or authoritative game data.
- **Injection/XSS surface:** multiple values are inserted using `innerHTML`, including log messages and generated controls. Current values are mostly internal constants, but a networked version must use text nodes/sanitization and a strict content security policy.
- **Third-party asset dependency:** Google Fonts adds an external runtime dependency and privacy/network failure mode; production can self-host approved fonts or explicitly document the dependency.
- **Encoding/asset correctness:** PowerShell output shows mojibake for multilingual source text/emojis and the image paths do not match the current root layout. Encoding and packaging must be verified before Android release.

## Recommended target architecture

```text
Android client / web presentation adapter (untrusted)
  ├─ rendering, input, animations, audio, local presentation cache
  └─ HTTPS REST + authenticated WSS
                    │
                    ▼
Backend
  ├─ authentication/session middleware
  ├─ authorization/game membership checks
  ├─ validated commands and rate limits
  ├─ authoritative game service + pure game engine
  ├─ server CSPRNG dice and server-side AI
  ├─ idempotency/version/concurrency control
  ├─ structured security/game logging
  └─ REST/WebSocket event contracts
                    │
                    ▼
Database/repository
  ├─ users/sessions
  ├─ games and versioned state
  ├─ event/history records
  └─ security/audit events
```

The engine should be shared only where safe. The server is the sole authority; any client-side move calculation is an optional UX hint and must be revalidated by the server.

## Migration plan

1. Add characterization tests around the current rule behavior and convert developer scenarios into fixtures.
2. Extract board math, state, legal moves, and transitions into a pure engine without changing rules.
3. Extract AI behind an engine interface and test every selected move for legality.
4. Modularize the current UI into a client/presentation layer that consumes engine-shaped snapshots.
5. Add backend authentication, game membership, validated commands, server dice, authoritative transitions, and persistence with atomic version checks.
6. Add REST/WSS contracts, reconnect/state synchronization, idempotency keys, rate limits, structured errors, and security logs.
7. Wrap/adapt the presentation client for Android, add secure token storage, release configuration, and production debug exclusion.
8. Add integration/concurrency/security tests, then complete deployment documentation and release verification.

## Current acceptance baseline

Before extraction, the existing browser game should be manually checked for: all setup modes, 2/3/4 active colors, team mode, each AI personality, tutorial progression, developer scenarios, all dice/bonus cases, Judwa formation/breaking, blocking/capture/safe squares, finishing/rankings, restart, language switching, and banner loading. No automated baseline exists yet, so this audit is the starting point for adding one.

## Open decisions for implementation

- Whether the backend should use Node.js (likely appropriate once a package/build is introduced) and which persistence layer is required for the deployment target.
- Whether the first Android client should be a Capacitor/WebView wrapper or a native UI.
- Authentication product choice (guest accounts, email/OAuth, or device-linked accounts), token/session lifetime, and matchmaking scope.
- Deployment provider, database, TLS termination, allowed origins, observability, and operational backup requirements.

---

## What changed since this audit

Added 2026-09-06, after the migration work. The audit above is kept verbatim; this section
records which of its findings were addressed and which are still open.

### Resolved

| Audit finding | Outcome |
| --- | --- |
| "No server, database, package manifest, build system, test suite, authentication or network protocol" | All now exist: `server/`, `node:sqlite` persistence, `package.json`, Gradle, 86 automated tests, HMAC session tokens, REST + WebSocket contracts. |
| Phase 1: domain extraction | `game/engine.js` — pure, no DOM or transport, injectable random source. `tests/rule-parity.test.js` compares it against the original page across 27 scenarios x 6 dice. |
| Phase 2: backend authority | `server/game-service.js` owns dice, turns, validation and completion; clients send intents with a version and idempotency key. |
| Phase 3: client adapter | `online-ui.js` maps authoritative snapshots into the preserved renderer; `client/authoritative-client.js` is the REST adapter. |
| Phase 4: Android packaging | WebView wrapper under `android/`, as the audit recommended over a native rewrite. |
| Client-authoritative dice | Server uses `crypto.randomInt` via `secureDie()`. |
| No identity or authorization | Accounts with scrypt hashing, signed sessions, per-game membership checks. |
| Replay/concurrency | Command idempotency keys, state-version checks, `BEGIN IMMEDIATE` transactions. |
| Debug exposure | Developer scenarios remain in the page but the release build disables WebView debugging; server-side dev auth is gated behind `NODE_ENV` and `ENABLE_DEV_AUTH`. |
| Google Fonts dependency | Outfit is self-hosted and bundled; subset to the glyphs actually used (2026-09-06). |
| Banner asset paths | Resolved during Android packaging; assets sync from root via the Gradle `syncGameAssets` task. |

### Still open

- **Rate limiting** is still the in-memory, single-process limiter the audit flagged. It keys on
  `request.socket.remoteAddress`, so behind a reverse proxy every client would share one bucket.
  A shared store or edge limiter is required before public deployment.
- **Horizontal scaling** still needs a reviewed shared-database and locking strategy; WebSocket
  subscriptions are held in process memory.
- **Data retention**: `games`, `players` and `commands` rows are never expired, so storage grows
  without bound.
- **Account deletion** is not implemented, which is a Google Play policy requirement.
- **`innerHTML` usage** in the preserved page has not been converted to text nodes, and there is
  no Content Security Policy.
- **No public deployment**: there is still no HTTPS/WSS backend, so online play is unavailable
  outside a local network.

