# Threat model

| Asset | Threat / attack vector | Mitigation | Residual risk |
|---|---|---|---|
| Game state and outcomes | Modified client submits positions, scores, or wins | Server owns state; commands contain intent; engine revalidates | Server bugs still require tests and review |
| Dice fairness | Predicting or replacing client dice | Server cryptographic randomness | No public verifiable-randomness scheme yet |
| Player identity | Forged `userId` or token | Signed expiring bearer sessions; identity from token | Session theft remains possible without device/session hardening |
| Private games | IDOR through guessed game IDs | UUID validation plus membership authorization | In-memory access control lacks durable audit history |
| Command replay | Repeated move or roll request | Command IDs and state versions | Idempotency store is process-local and bounded |
| Concurrent moves | Two requests race the same turn | Version check in service; single-process event ordering | Database transaction/lock still required for multiple instances |
| API availability | Oversized/automated requests | Body limit; rate limits are still required | No distributed limiter yet |
| WebSocket channel | Unauthorized subscription/event spoofing | Auth message, membership-checked subscription, event validation, payload/rate limits | Durable replay history and TLS deployment still required |
| Secrets | API/JWT/database secret embedded in APK/repository | Environment-only signing secret; no client secret design | Deployment secret management is still an operator responsibility |
| Debug controls | Force-roll/scenario access in production | Development endpoint is environment-gated; Android release query removes the Developer Mode entry/actions | Modified APKs can re-enable local-only debug code; server remains the security boundary |
| Sensitive logs | Token/password leakage | Generic responses and no secret logging in new server code | Logging pipeline and redaction tests pending |
