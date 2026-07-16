# ADR: Password KDF Versioned Migration (F4)

Status: Proposed (design approved; implementation gated behind UCS final acceptance).
Date: 2026-07-16. Design-only — no code/schema/deploy change.
Related: `PASSWORD_KDF_MIGRATION_DESIGN_REPORT.md`, `PASSWORD_HASH_FORMAT_SPEC.md`,
`PASSWORD_KDF_CALLSITE_INVENTORY.md`, `PASSWORD_KDF_THREAT_MODEL.md`,
`PASSWORD_KDF_MIGRATION_STATE_MACHINE.md`, `PASSWORD_KDF_ACCEPTANCE_MATRIX.md`,
`PASSWORD_KDF_ROLLOUT_AND_ROLLBACK_PLAN.md`, `SECURITY_FINDINGS_TRIAGE_REPORT.md` (F4).

## ADR-1 — Why single-round SHA-256 is inadequate

`SHA-256(salt+password)` is a fast hash with no work factor; a leaked DB is brute-forced at
~10^10 guesses/s/GPU. Salting defeats rainbow tables but not brute force. Plus a non-constant-time
compare and no algorithm/version agility. Modern practice requires a slow, parameterized KDF.

## ADR-2 — Selected KDF: PBKDF2-HMAC-SHA-256 (Web Crypto)

**Decision: PBKDF2-HMAC-SHA-256** via `crypto.subtle.deriveBits`. It is natively available in the
Workers runtime (compat 2025-09-01), zero-dependency, and stable.

Rejected:
- **scrypt** — not in Web Crypto; needs a JS/WASM library ⇒ supply-chain + CPU/memory risk on
  Workers; memory-hardness benefits are undercut by Workers memory limits.
- **Argon2id** — strongest, but requires a WASM dependency with unproven Workers stability, memory
  cost, and supply-chain surface. Per the mission's rule, a stronger algorithm the production runtime
  cannot stably support is not selected. Argon2id may be revisited via the versioned record if a
  vetted, Workers-stable implementation is proven later.

## ADR-3 — Versioned, self-describing record; single-field encoding

Record: `$pbkdf2-sha256$v=<ver>$i=<iterations>$<salt_b64>$<dk_b64>` stored in `user.password`.
**No schema migration** (chosen over adding `pwd_algo`/`pwd_params` columns) to avoid `ALTER TABLE`
on the production `user` table, keep the record atomic, and keep algorithm+params+salt+dk together.
`user.salt` retained for legacy; unused for new records.

## ADR-4 — Legacy verification & upgrade

Legacy = `password` not starting with `$pbkdf2-sha256$`. Verified via `SHA-256(salt+password)`
(salt from column). Unambiguous (SHA-256 base64 never starts with `$`). On successful legacy login,
trigger lazy rehash to CURRENT. Upgrade-write failure is swallowed (login already succeeded); the
next login retries. Never fall back legacy↔new on a malformed record (fail closed).

## ADR-5 — Lazy rehash atomicity & failure semantics

On verify success with `needsRehash`, derive a CURRENT record (fresh salt) and
`UPDATE user SET password=:new, salt='' WHERE user_id=:id AND password=:oldExact`. 0 rows affected
⇒ a concurrent reset/rehash already changed it ⇒ no-op. Login never blocks on the rehash (V7). The
`WHERE oldExact` guard prevents clobbering a concurrent password reset (V8) and, with writers only
ever emitting CURRENT, prevents downgrade (V9).

## ADR-6 — New-password writes always CURRENT

Register, addUser, resetPassword/setPwd, provisioning (W1–W5) all call one shared
`pbkdf2Encode(pw, CURRENT_ITERATIONS)`; after implementation **no path emits a legacy hash**.

## ADR-7 — Constant-time verification

No `timingSafeEqual` in Web Crypto. Compare raw derived-key bytes with an XOR-accumulate
`ctEqual(a,b)` (length pre-check acceptable; dklen public). Applies to the new-format path; legacy
path is superseded by rehash.

## ADR-8 — Parameter tuning & version upgrades

`CURRENT_VERSION`/`CURRENT_ITERATIONS` are named constants; every record stores the params it used,
so verification is target-independent. Raising cost = bump the constants; existing records verify at
their encoded params and upgrade on next login. Parameters are chosen by measured acceptance
(E13) on the deployed plan, never hardcoded as an immutable contract.

## ADR-9 — Emergency rollback boundary

Allowed: stop lazy rehash (flag off), roll back application code. Constraints: upgraded hashes are
never destructively rewritten; a rollback target that **cannot verify** new-format hashes is not a
valid rollback once Phase B has begun. Safe target = the verify-both build; pre-F4 is unsafe after
any upgrade. (Full matrix in the rollout plan.)

## ADR-10 — UCS parallel boundary

F4 implementation and deployment must wait for UCS Parity PASS + projection-read cutover + target
Build + real-iPhone acceptance, unless a separate, authorized, urgent auth-security incident arises.
F4 must not modify UCS runtime/checkpoint/cursor/lease/outbox/projection/parity/flag or write the
UCS evidence epoch files. This design Mission created no Worker Version and declared no fix as
deployed (V19/V20).
