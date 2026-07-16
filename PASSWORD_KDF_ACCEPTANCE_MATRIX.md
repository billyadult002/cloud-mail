# Password KDF Acceptance Matrix (F4)

Mission: CLOUDMAIL PASSWORD KDF VERSIONED MIGRATION DESIGN. Date: 2026-07-16. Design-only.
Tests specified for the future implementation mission. **Synthetic users only** (A13) — no real
password/salt/hash is ever read, generated from production, or exported (A15/E9).

## Unit / integration scenarios (A17)

| # | Scenario | Expected |
|---|----------|----------|
| T1 | legacy record, correct password | `ok=true`, `needsRehash=true` |
| T2 | legacy record, incorrect password | `ok=false`, no rehash |
| T3 | new-format record, correct password | `ok=true`, `needsRehash=false` (at CURRENT params) |
| T4 | new-format record, incorrect password | `ok=false` |
| T5 | malformed new record (`$pbkdf2-sha256$…` truncated/bad b64) | `ok=false`, fail-closed, redacted audit |
| T6 | unknown version/scheme (`$pbkdf2-sha256$v=999…`, `$argon2…$`) | `ok=false`, fail-closed |
| T7 | lazy rehash success | after T1 login, record becomes CURRENT; re-login → `needsRehash=false` |
| T8 | lazy rehash write failure (UPDATE throws/timeouts) | login still succeeds; record unchanged; no error surfaced |
| T9 | concurrent login rehash (two verifies race) | exactly one UPDATE applies; other no-ops; final record CURRENT |
| T10 | concurrent password reset vs lazy rehash | reset value persists; rehash no-ops (WHERE oldExact) |
| T11 | new user registration | writes CURRENT format; no legacy hash |
| T12 | admin addUser | writes CURRENT format (parameterized SQL, F1) |
| T13 | provisioning | writes CURRENT format |
| T14 | password reset (/reset-password, /my/resetPassword) | writes CURRENT format |
| T15 | set password (/user/setPwd) | writes CURRENT format |
| T16 | delegated authorization (owner_password) | format-aware verify; rehash on success |
| T17 | downgrade prevention | no code path writes legacy over CURRENT; property test asserts writer only emits CURRENT |
| T18 | rollback compatibility | a Phase-A (verify-both) build verifies a CURRENT record produced by Phase-B |
| T19 | constant-time compare | `ctEqual` returns correct boolean; unit test on equal/unequal-length and single-bit diff |
| T20 | params upgrade | record at `i=old` verifies; on login, rehash to `i=CURRENT`; re-login `needsRehash=false` |

## Security assertions

- No test logs or asserts on real password/salt/hash values; fixtures are synthetic (A13/A15).
- Verify path asserts fail-closed for every malformed/unknown input (T5/T6/T8).
- Property test: for all inputs, `pbkdf2Encode` output starts with `$pbkdf2-sha256$` (never legacy).

## Performance acceptance (E13) — not a production benchmark

At implementation, measure PBKDF2 latency/CPU at candidate iteration counts on the **target Workers
runtime/plan** (dev + staging), not a desktop. Record p50/p95 CPU-ms and select the highest
iteration count that stays within the plan's per-request CPU budget with margin. Document the
measured environment; do not present any estimate as a production benchmark.

## Runtime driving (verify skill)

Implementation must exercise the real login flow against synthetic users in staging (drive
`/login`, `/register`, `/reset-password`) and observe `needsRehash` transitions in the DB — not only
unit tests — before any production canary.
