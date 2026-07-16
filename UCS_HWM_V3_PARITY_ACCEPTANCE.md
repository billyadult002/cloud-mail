# UCS HWM V3 Parity Acceptance

Mission: UCS HWM V3 CONTROLLED PRODUCTION ACTIVATION … Date: 2026-07-16
Status: **PARITY_PENDING_CONVERGENCE** — parity has NOT executed yet; prerequisites not all met.

## Parity eligibility gate (native, no manual injection — A11/V12/V14)

Parity runs inside `monitorScheduled` only when `run.ready && membership.ready`
(`unified-conversation-backfill-service.js:102`) and `parityWorkspace` requires the backfill
checkpoint `state='ready'`. Current production state:

| Prerequisite | Required | Now |
|--------------|----------|-----|
| backfill READY at frozen W | yes | ✅ ready, hw=3807 |
| membership READY | yes | ✅ ready |
| V3 ≤W re-materialized to current version | yes | ⏳ in progress (cursor at 2026-07-13, W=2026-07-16 19:23:13) |
| V3 READY latch | yes (for a passable content check) | ⏳ pending |

Backfill + membership are eligible; **parity will begin executing on the per-minute cron even
before V3 completes**, but it will not PASS until V3 has brought every ≤W projection to the
current `MATERIALIZER_VERSION` (otherwise `contentMismatch`/`missing` > 0). Therefore the
meaningful acceptance is a parity run *after* V3 READY.

## Acceptance criteria (to record on the passing run — E11 / V15 / V16 / A12 / A13)

All scoped to the same frozen watermark (`conversation_projection_parity` row):

| Metric | Required |
|--------|----------|
| coverageMissing (≤W) | 0 |
| missing | 0 |
| extra | 0 |
| contentMismatch | 0 |
| unexplained (failures≤W + outbox≤W) | 0 |
| duplicates | 0 |
| orphans | 0 |
| unresolved failures | 0 |
| quarantine growth | 0 |
| `passed` | 1 |

## Verification method (read-only, when convergence completes)

```
-- parity result for W2 (latest, per surface)
SELECT surface_key,high_watermark,legacy_count,projection_count,missing_count,extra_count,
       content_mismatch_count,unexplained_count,passed,audit_run_id
FROM conversation_projection_parity WHERE tenant_id=1 AND workspace_id=2
ORDER BY rowid DESC;
-- integrity cross-checks
-- duplicates: current projections per conversation > 1
-- orphans: current projections without a live aggregate
-- failures: conversation_pipeline_failures resolved_at IS NULL (source ≤ W)
-- quarantine: checkpoint quarantined_count deltas
```

## First native parity execution captured (19:37:43 UTC, read-only)

Parity is already running natively (backfill+membership READY). Latest per-surface rows at
evaluated `high_watermark=3807`:

| metric | value |
|--------|-------|
| missing | 0 (attachments surface: 5) |
| extra | 0 |
| contentMismatch | **1350** |
| unexplained | **1658** (outbox_le_w 1655 + failures 0) |
| duplicates | 0 |
| orphans | 0 |
| unresolved failures | 0 |
| passed | **0** (all surfaces) |

This satisfies E11 (first native parity execution) and V15/E13 (same frozen `hw=3807` snapshot),
and confirms A11 (native control path, no injection). It is **not** a PASS.

## Two remaining gates to `passed=1`

1. **contentMismatch → 0**: V3 must finish re-materializing all ≤W aggregates to the current
   materializer version (~5/min; hours).
2. **unexplained → 0**: the ≤W ingest-outbox (1655) must drain via native `processIngestOutbox`
   (~2/min; ~14 h). Slower long-pole.

## Current verdict

Parity **not yet passed** (passed=0). Do not assert PASS. `contentMismatch`/`unexplained` > 0 is
the *expected in-progress* state, not a design failure. Re-run this acceptance after both long-poles
reach 0 and V3 is READY-latched.
