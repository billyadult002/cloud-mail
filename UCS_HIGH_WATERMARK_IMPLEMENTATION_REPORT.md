# UCS High-Watermark Implementation & Staging Verification — Report

Mission: UCS HIGH-WATERMARK IMPLEMENTATION AND STAGING VERIFICATION
Date: 2026-07-16
Baseline: tag `v2026.07-f3-logout`; prod Worker `d05ffd3e-…` (unchanged by this mission).

## Outcome

High-watermark completion implemented behind a default-off flag, unit + integration tested
(9/9), committed, tagged `v2026.07-ucs-hwm`, and deployed to **staging** (Worker `500395a9`).
**Production was not redeployed or edited** (A8). No schema migration.

## Change surface (`src/service/unified-conversation-backfill-service.js`)

New pure, exported helpers:
- `hwmEnabled(env)` — reads `env.UCS_HWM_COMPLETION_ENABLED==='true'` (default OFF).
- `shouldFreezeWatermark(checkpoint)` — true only when `high_watermark` is null/'' (write-once).
- `watermarkScope(W, enabled)` — returns `{forward, outbox, failures}` SQL fragments
  (`AND e.email_id<=W`, `AND source_message_id<=W`, `AND (source_ref NOT LIKE 'email:%' OR
  CAST(REPLACE(source_ref,'email:','') AS INTEGER)<=W)`); empty strings when disabled;
  coerces W to a number (injection-safe).

`runWorkspace` (flag ON):
1. **Freeze W at epoch open (write-once):** if the checkpoint has no watermark, snapshot
   `W = MAX(visible email_id)` and persist it with `WHERE ... (high_watermark IS NULL OR
   high_watermark='')` — immutable thereafter.
2. **Scope forward fetch to ≤W:** `... AND e.email_id>?3 AND e.email_id<=W ORDER BY e.email_id`.
3. **Latched readiness:** the existing `ready = rows.length < remaining` now evaluates against
   the immutable ≤W set, so once the cursor reaches W it stays ready; mail >W is out of scope.
4. **Preserve frozen W on commit:** when enabled, the commit binds `high_watermark = frozenW`
   and the legacy "raise to live MAX" capture is skipped.

`parityWorkspace` (flag ON): `failures` and `outbox` counts gain the ≤W predicates, so
`unexplained = failures(≤W) + outbox(≤W)` is no longer inflated by live growth.

Flag OFF: every branch falls back to the exact prior code (verified byte-identical behavior by
the flag-off unit + integration tests).

## Evidence (E1–E5)

- **E1 current readiness / E2 current parity** — `runWorkspace:66` (`rows.length<remaining`,
  un-latching) and `parityWorkspace:76` (unscoped `failures`/`outbox`); both reproduced and
  preserved under flag-off tests.
- **E3 watermark creation** — integration test *flag ON fresh*: write-once freeze UPDATE issued;
  return `highWatermark: 100`.
- **E4 ready latch** — integration test *second run*: no re-freeze; forward stays `≤100`; commit
  keeps `high_watermark='100'`; `ready=true` while a live row >W would be excluded by scope.
- **E5 parity eligibility** — integration test *parity ON*: failures/outbox SQL carry `≤100`;
  `passed=true` at zero ≤W counts.

## Tests (A4–A6)

`scripts/reliability-tests/ucs-high-watermark-completion.test.mjs` — **9/9 pass** (pool-workers):
4 unit (helpers, incl. injection-safety) + 5 integration (freeze/scope/commit/latch flag-on,
legacy flag-off, parity scope on/off). Regression: `npm run test:unit` green; existing
`unified-conversation-system` + F1 + F3 tests pass (24/24). Full UCS behavioral paths are
exercised by the integration harness because staging lacks UCS activation/data (below).

## Verification (V1–V6)

| ID | Requirement | Result |
|----|-------------|--------|
| V1 | Ready becomes reachable | ✅ frozen ≤W set under-fills → `ready=true` (int. test 1) |
| V2 | Ready remains latched | ✅ second run stays ready, W unchanged (int. test 2) |
| V3 | Continuous ingest does not reset ready | ✅ forward capped ≤W excludes >W mail (int. test 2) |
| V4 | Parity becomes eligible | ✅ `unexplained` scoped ≤W; `passed=true` (int. test parity ON) |
| V5 | No duplicate processing | ✅ freeze write-once + digest/receipt idempotency unchanged; re-claim re-reads same W (int. test 2) |
| V6 | No record loss | ✅ ≤W inclusive scope; >W deferred to next epoch (design); flag-off preserves legacy |

## Staging verification (A7) — Worker `500395a9`

- `wrangler deploy --env staging` → Worker `500395a9-f485-47d4-bf13-952ca33ab93c` (14:23:50 UTC),
  isolated env (D1 `cloud-mail-staging`, no crons, `UCS_ACTIVATION_ENABLED` unset, flag unset ⇒ off).
- Health: `GET /api/setting/websiteConfig` → HTTP 200 transport; body `code=501 "数据库未初始化"`
  — the staging D1 is un-seeded; this confirms the Worker **builds, boots, routes, and executes**
  the settings path (no code/startup fault from the change). Full UCS behavior is not exercisable
  on staging (UCS disabled, no data), so the authoritative behavioral evidence is the integration suite.
- Production confirmed **unchanged**: still `d05ffd3e-…` (F3), not redeployed.

## Audit answers

- **Can ready become true?** Yes — forward scoped ≤W under-fills once the cursor reaches the frozen W.
- **Can ready revert?** No — mail >W is out of scope, so subsequent runs stay ready (latched).
- **Can parity execute?** Yes — failures/outbox scoped ≤W remove the live-growth block; with zero ≤W counts it passes.
- **How are >W records handled?** Excluded from the frozen epoch; covered by a future epoch/watermark; never dropped.
- **Is replay deterministic?** Yes — `high_watermark` is write-once (`WHERE high_watermark IS NULL`), so re-claim re-reads the same W and the same ≤W scope; projections idempotent via receipts/digests.
- **Is rollback possible?** Yes — set `UCS_HWM_COMPLETION_ENABLED=false`/unset for byte-identical legacy behavior (no redeploy), or revert to tag `v2026.07-f3-logout`; no migration; data-safe.

## Provenance

Commit `5a40b0b2bee4919af852da7b03dbb2ccadb5fb91`; tag `v2026.07-ucs-hwm`; staging Worker
`500395a9-f485-47d4-bf13-952ca33ab93c`. Production `d05ffd3e-…` unchanged.

## Boundaries honored

No production checkpoint/cursor/lease/outbox edit; no projection enablement; no forced parity;
only source + tests + staging deploy + ADR. Concurrent UCS-monitor files untouched.
