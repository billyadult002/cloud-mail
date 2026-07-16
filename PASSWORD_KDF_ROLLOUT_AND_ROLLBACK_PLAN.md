# Password KDF Rollout & Rollback Plan (F4)

Mission: CLOUDMAIL PASSWORD KDF VERSIONED MIGRATION DESIGN. Date: 2026-07-16. Design-only.
Nothing here is executed by this Mission. Implementation is gated behind UCS final acceptance (ADR-10).

## Two-phase, verify-first rollout (the core safety property)

**Phase A — VERIFY-BOTH, WRITE-LEGACY (rollback-safe baseline).**
Deploy code that can *verify* both legacy and new-format records but still *writes* legacy on all
paths (or writes new only behind a flag default-off). Purpose: make the entire fleet capable of
verifying new-format hashes **before any new-format hash exists**. No user record changes yet.

**Phase B — WRITE-NEW + LAZY-REHASH (behind `PWD_KDF_V2_ENABLED`, default off → canary).**
Enable new-format writes on all W1–W5 paths and lazy rehash on successful verify. New-format records
now appear. Because Phase A already verifies them, every running instance can authenticate upgraded
users. Rollback target during Phase B = **Phase A build** (verify-both), which is safe.

### Rollback compatibility matrix (ADR-9 / V15 / E14)

| Rollback target | Verifies legacy? | Verifies new-format? | Safe after Phase B? |
|-----------------|------------------|----------------------|---------------------|
| Pre-F4 (`d05ffd3e`/HWM line) | yes | **no** | **NO — would lock out upgraded users** |
| Phase A (verify-both, write-legacy) | yes | yes | **YES** |
| Phase B (verify-both, write-new) | yes | yes | YES |

**Hard rule:** once any user is upgraded (Phase B begins), rolling back to a build that cannot
verify new-format is **forbidden**. Emergency mitigation order: (1) flag off `PWD_KDF_V2_ENABLED`
(stops new writes + rehash; already-upgraded hashes remain verifiable by Phase A/B) → (2) rollback
to Phase A build → never to pre-F4. Upgraded hashes are never destructively rewritten.

## Staging (A13)

Seed **synthetic** users only (no production data). Exercise: legacy login→rehash, new registration,
reset, setPwd, provisioning, delegated auth, malformed/unknown fail-closed, concurrency. Verify
`needsRehash` transitions in the staging DB. Measure KDF cost (E13) on the staging plan.

## Production canary (A14 / A21)

Server remains authoritative throughout. Sequence:
1. Deploy Phase A to production (verify-both). No behavior change; confirm health + that legacy
   logins still work and new-format verify is reachable (synthetic check).
2. Enable Phase B for a **bounded canary** — a small cohort (e.g. admin/test accounts or a
   percentage flag) — observe: login success rate, verify latency/CPU, rehash success rate, zero
   auth-error spike. Metrics are counts/latency only; **never** log password/salt/hash (A15).
3. Expand only if canary is clean; otherwise flag off (Phase A remains safe).

## Provenance (A16)

Each deploy records Commit SHA + Release Tag + Worker Version in `DEPLOYMENT_PROVENANCE_REPORT.md`
per the deployment-provenance standard. Tags e.g. `v2026.07-f4-kdf-verify` (Phase A),
`v2026.07-f4-kdf-write` (Phase B). This design Mission creates **no** Worker Version and **no**
production/staging deploy (V19/V20/A20).

## UCS non-interference (ADR-10 / V18 / A21-UCS)

Implementation and deployment MUST wait until UCS Parity PASS, projection-read cutover, target Build,
and real-iPhone acceptance are complete — **unless** an independent, authenticated, authorized
security incident requires an emergency auth fix. No F4 change may touch UCS checkpoint/cursor/lease/
outbox/projection/parity/flag or the UCS evidence epoch files.
