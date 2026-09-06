# Security

## Trust model

The Android/browser client is untrusted. It may be modified, automated, disconnected, or replayed. The backend and its database are the authority for identity, membership, dice, turns, movement, AI, wins, and results.

## Implemented in this increment

- Signed, expiring bearer session tokens with an environment-only HMAC secret.
- Account registration/login with salted Node scrypt password hashes and a dedicated authentication rate limit.
- Production refusal when `AUTH_SIGNING_SECRET` is missing or shorter than 32 characters.
- Identity derived from the authenticated token, not a request `userId`.
- Game membership and color ownership checks.
- Strict game/command ID and JSON payload validation.
- Rejection of unknown JSON fields at the HTTP boundary.
- Explicit allowlisted CORS for the Android asset origin; null/file origins are disabled unless explicitly enabled for development.
- Server-side die generation using Node's cryptographic random source.
- Server-side move validation through the pure engine; destination/state injection is not accepted.
- Server-owned AI seats and legal-move selection; the client cannot submit an AI decision.
- State-version checks and command idempotency for duplicate/replayed commands.
- Payload size limit and generic client errors.
- Development-only session issuing endpoint, disabled in production.
- Authenticated WebSocket channel with pre-subscription authorization, payload limits, event validation, and rate limiting.
- No secrets committed; `.env.example` contains placeholders only.
- Parameterized SQLite statements and explicit schema constraints in the persistence adapter.

## Still required before production

- Replace or front the development SQLite repository with the deployment database and a reviewed shared row/advisory-lock strategy for horizontally scaled production; the current SQLite path uses atomic write transactions within one database process.
- Add durable sessions/revocation, account recovery, refresh-token rotation, and an external identity provider or fully reviewed account system.
- Add HTTPS at the edge/WSS deployment, origin allowlisting, CORS/CSRF policy appropriate to the client, connection limits, and structured redacted security logs.
- Add durable reconnect replay protection and event history; the current socket uses state synchronization and process-local command idempotency.
- Add persistent event history, backups, monitoring, alerting, and abuse controls.
- The Android online session flow now uses a narrowly scoped WebView bridge backed by the Android Keystore token store. Release-only configuration, disabled debug routes, minimized exported components, and optional justified certificate pinning remain deployment checks.
- Debug Android builds permit private-LAN HTTP only to support a Windows development server; release builds retain cleartext-disabled HTTPS/WSS-only transport.
- Run dependency, SAST, DAST, concurrency, and release-secret scans in CI.

The in-memory service is not horizontally scalable or durable and must not be presented as production-ready until those controls are implemented.
