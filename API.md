# API contract (initial HTTP boundary)

All protected requests require `Authorization: Bearer <session-token>`. The server derives the user identity from the token; client-supplied `userId` values are ignored.

## Development-only session

`POST /v1/auth/dev-session`

```json
{"userId":"alice"}
```

Available only when `NODE_ENV` is not `production` and `ENABLE_DEV_AUTH=true`. Production must replace this with the deployed identity provider while retaining token verification at the API boundary.

## Account session

`POST /v1/auth/register` and `POST /v1/auth/login` accept `{ "username": "...", "password": "..." }`. Passwords must be at least 12 characters; the server stores a salted scrypt hash and returns a short-lived signed bearer session. Registration and login are rate-limited. Public deployments should add email verification, session revocation/refresh rotation, recovery, and operational account controls.

## Games

- `POST /v1/games` — create a game. Body may include `activeColors`, `teamMode`, and `mode`.
- `POST /v1/games/:gameId/join` — join an available color.
- `GET /v1/games/:gameId/state` — retrieve authoritative state after reconnect.
- `POST /v1/games/:gameId/commands` — submit one validated intent.

Supported commands are `ROLL_DICE`, `SELECT_DIE`, `MOVE_PIECE`, `PASS_TURN`, `END_TURN`, and `REQUEST_STATE`. `SELECT_DIE` changes only the server-side selected pending die; `PASS_TURN` is accepted only when all pending dice have no legal move and no bonus action is pending.

Command body:

```json
{"command":"ROLL_DICE","commandId":"unique-client-id","expectedVersion":0}
```

```json
{"command":"MOVE_PIECE","commandId":"unique-client-id","expectedVersion":1,"pieceIds":["red0"],"kind":"single"}
```

The move request contains piece identity and move kind only. It does not contain a destination, dice result, score, or replacement state. The server derives legality from its current state and dice. Reusing a command ID returns the original result; using a stale `expectedVersion` returns a conflict.

## Error behavior

Errors are intentionally generic at the HTTP boundary. Detailed diagnostics belong in structured server logs and must not include tokens, passwords, or connection secrets.

## WSS events

`GET /v1/realtime` is an authenticated WebSocket endpoint. The current implementation requires an `AUTH` message within five seconds, then a membership-checked `SUBSCRIBE` message. Supported client messages are `AUTH`, `SUBSCRIBE`, `REQUEST_STATE`, and `COMMAND`. Server messages include `AUTHENTICATED`, `GAME_STATE`, `COMMAND_RESULT`, and generic `ERROR` responses.

The Node listener is intended to run behind an HTTPS/WSS TLS terminator in production. It limits payloads, authenticates before subscription, rechecks membership, validates commands, and uses the same state-version/idempotency rules as HTTP.
