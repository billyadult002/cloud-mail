# Password KDF Versioned Migration — Design Report & Product Decision (F4)

Mission: CLOUDMAIL PASSWORD KDF VERSIONED MIGRATION DESIGN AND PRODUCT DECISION
Date: 2026-07-16. **Design-only.** No code/schema change, no deploy, no real secret read, no UCS interference.

## Non-interference attestation (E15 / V18–V20 / A19–A21)

Read-only source inspection only. No modification to crypto-utils/login/public/user/mailbox-auth/
cloudmail-v2 services, user entity, wrangler.toml, env, or any migration. No staging/production
deploy, no Worker Version created. No UCS checkpoint/cursor/lease/outbox/projection/parity/flag
touched; **the UCS evidence epoch files (`task.md`, `implementation_plan.md`, UCS ADR/acceptance)
were not written** — this Mission uses only its own `PASSWORD_KDF_*` files to avoid write-races with
the running convergence monitor. No real password/salt/hash was read, logged, or exported.

## Product Decision (Required Output #9 / A18 — a single decision, not options)

| Aspect | Decision |
|--------|----------|
| **KDF** | PBKDF2-HMAC-SHA-256 via Web Crypto `deriveBits` (native, zero-dependency, Workers-stable). |
| **Rejected** | scrypt, Argon2id — not in Web Crypto; require WASM/JS libs (supply-chain, memory, Workers-compat risk). Revisitable via the versioned record later. |
| **Record format** | Self-describing single field in `user.password`: `$pbkdf2-sha256$v=<ver>$i=<iter>$<salt_b64>$<dk_b64>`. |
| **Schema** | **No migration** (self-describing encoding); `user.salt` retained for legacy. |
| **Legacy compat** | Records not starting with `$pbkdf2-sha256$` verified via existing SHA-256 path; unambiguous. |
| **Lazy rehash** | On successful verify of a legacy/below-target record, conditional `UPDATE … WHERE password=oldExact`; best-effort, never blocks login. |
| **Forced reset** | Not required — migration is lazy per login. Optional future policy: force reset for accounts inactive beyond a threshold (out of scope now). |
| **Constant-time** | `ctEqual` XOR-accumulate over derived-key bytes (no Web Crypto primitive). |
| **Parameters** | `v=1`, iterations selected by measured acceptance on the deployed plan (candidate 100k–210k); constants, version-tagged, raisable. |
| **Operational limits** | Validate PBKDF2 CPU cost vs the Workers plan budget (Free ~10 ms/req); escalate to Paid/allowance if needed; fail-closed on KDF error/timeout; cap login body size. |

## Evidence & specifications (see companion docs)

- Callsites/schema/runtime: `PASSWORD_KDF_CALLSITE_INVENTORY.md` (E1–E6).
- Record grammar, legacy ID, fail-closed, constant-time: `PASSWORD_HASH_FORMAT_SPEC.md` (E7/E8).
- Threats & runtime constraint: `PASSWORD_KDF_THREAT_MODEL.md`.
- Lazy rehash / concurrency / downgrade / fail-closed: `PASSWORD_KDF_MIGRATION_STATE_MACHINE.md` (E10–E12).
- Tests (synthetic only) + perf method: `PASSWORD_KDF_ACCEPTANCE_MATRIX.md` (E13, A17).
- Two-phase verify-first rollout + rollback matrix: `PASSWORD_KDF_ROLLOUT_AND_ROLLBACK_PLAN.md` (E14).
- Decisions of record: `docs/ADR-PASSWORD-KDF-VERSIONED-MIGRATION.md` (ADR-1…10).

## Audit answers (mission)

1. Current algorithm: single-round `SHA-256(salt+password)`, non-constant-time compare.
2. Hash-write entrypoints: register, addUser, resetPassword/setPwd, provisioning (W1–W5).
3. Verify entrypoints: login, admin genToken, delegated owner_password (V1–V3).
4. Legacy ID: `password` not starting with `$pbkdf2-sha256$`.
5. Target KDF: PBKDF2-HMAC-SHA-256 — native/stable/zero-dep on Workers.
6. Rejected: scrypt/Argon2id — non-native, dependency/supply-chain/memory risk.
7. New record: `$pbkdf2-sha256$v=<ver>$i=<iter>$<salt_b64>$<dk_b64>`.
8. Params/version encoded in the record (self-describing).
9. Legacy users log in via the SHA-256 path unchanged.
10. Lazy rehash: on successful legacy/below-target verify.
11. Rehash failure: swallowed; login still succeeds; retried next login.
12. Concurrent reset: `WHERE password=oldExact` guard ⇒ reset wins, rehash no-ops.
13. Downgrade prevention: writers emit only CURRENT; no CURRENT→legacy path.
14. Malformed/unknown: fail-closed (deny), redacted audit.
15. New-hash creators: W1–W5 via shared `pbkdf2Encode`.
16. Constant-time: `ctEqual` over derived-key bytes.
17. Future params: bump constants; records self-describe; upgrade on next login.
18. Schema migration: **not required**.
19. Rollback verifies upgraded users: only if the target is a verify-both build; pre-F4 is unsafe after Phase B.
20. Tests avoid real data: synthetic users only; no real secret read/export.
21. Server-authoritative: server verifies; canary flag-gated; no client trust change.
22. UCS impact: none — no UCS state or epoch files touched.
23. Why design now / not implement: F4 design needs no runtime change and is safe in parallel; implementation would redeploy the UCS-monitored Worker and change auth behavior, so it is gated behind UCS final acceptance (ADR-10).
24. Next mission authority: below.

## Next Mission (prepared, NOT started — Required Output #10 / A22)

**CLOUDMAIL PASSWORD KDF VERSIONED MIGRATION IMPLEMENTATION** — authorized to begin **only after**
UCS `PARITY_PASS_VERIFIED` → projection-read cutover → target Build → real-iPhone acceptance are all
complete (or a separately authorized urgent auth-security incident). Scope: implement the format
spec + state machine in `crypto-utils.js` and the W1–W5/V1–V3 callsites; add the acceptance-matrix
tests (synthetic); Phase-A (verify-both) then flag-gated Phase-B (write-new+rehash); staging verify;
production canary; provenance per standard. Must not modify UCS state. This design Mission does not
start it.

## Verdict

**F4_DESIGN_COMPLETE** — product decision made, all specs/ADRs/acceptance/rollout defined, no secret
read, no code/schema/deploy change, no UCS interference. F4 remains **NOT fixed / NOT deployed**.
