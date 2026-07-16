# Password KDF Threat Model (F4)

Mission: CLOUDMAIL PASSWORD KDF VERSIONED MIGRATION DESIGN. Date: 2026-07-16. Design-only.

## Asset

User authentication secrets stored in D1 `user.password` / `user.salt` (currently
single-round `SHA-256(salt+password)`), plus the verification path in the Worker.

## Current weaknesses (ADR-1)

1. **Fast offline cracking.** One SHA-256 per guess is GPU-cheap (~10^10 guesses/s/GPU). A DB
   exfiltration ⇒ rapid recovery of weak/medium passwords. Salting stops rainbow tables but not
   brute force; there is no work factor.
2. **Non-constant-time compare.** `hash === storedHash` may leak a timing signal. Low practical
   severity (the compared value is a server-side digest, not attacker-chosen plaintext), but it is
   free to fix and required by A7/V11.
3. **No agility.** No algorithm/version/params metadata ⇒ cannot raise cost or change algorithm
   without breaking existing users.

## Threats & mitigations (target design)

| Threat | Vector | Mitigation |
|--------|--------|-----------|
| Offline brute force after DB leak | D1 exfiltration | PBKDF2-HMAC-SHA-256 with a tuned high iteration count (work factor); versioned so it can be raised |
| Timing side-channel on verify | repeated auth timing | constant-time byte compare of derived keys (ADR-7) |
| Algorithm-confusion | a PBKDF2 record misread as legacy SHA-256 (or vice-versa) | unambiguous self-describing prefix; fail-closed on parse (E7/E8/V3/V10) |
| Downgrade attack | forcing a strong record back to SHA-256 | writers only ever emit new-format; rehash is legacy→new / new→stronger only; never new→legacy (V9) |
| Rehash race clobbering a reset | concurrent login-rehash vs password reset | conditional `UPDATE … WHERE password=<exact old>`; reset wins (V8) |
| Rollback lockout | rollback to code that can't verify new hashes | verify-first rollout: fleet verifies new-format BEFORE any is written; pre-F4 is not a safe rollback target after write-phase (ADR-9/V15) |
| Runtime DoS via KDF cost | oversized iterations exhaust the Worker CPU budget | parameters validated against the deployed plan's CPU limit; fail-closed on KDF error/timeout (E12); cap login body sizes |
| Secret exposure in logs/tests | debugging, benchmarks | never log password/salt/full hash; metrics are counts/latency only (A15); tests use synthetic users only (A13) |

## Runtime constraint (explicit)

Cloudflare Workers Free plan imposes ~10 ms CPU/request; PBKDF2 at very high iteration counts can
exceed it. The parameter policy (ADR-2/ADR-8/E13) requires validating the chosen iteration count
against the **actual deployed plan** before production — not assuming a desktop benchmark. If the
plan's CPU budget cannot support a defensible iteration count, the product decision escalates to a
Paid-plan requirement or a login-path CPU allowance, recorded as an operational limit.

## Non-goals / out of scope

No bulk decryption/export, no plaintext recovery, no reading real hashes, no server-side password
storage change other than the versioned record. Migration is strictly lazy (per successful login).
