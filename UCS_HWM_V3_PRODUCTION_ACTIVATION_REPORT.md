# UCS HWM V3 Controlled Production Activation — Report

Mission: UCS HWM V3 CONTROLLED PRODUCTION ACTIVATION, CONVERGENCE, PARITY, AND FINAL ACCEPTANCE
Date: 2026-07-16
Verdict: **PRODUCTION_CONVERGENCE_IN_PROGRESS** (deployed + enabled + natively converging;
parity PASS and FULL_PRODUCTION_PASS NOT yet reached — they require hours of native scheduled
convergence, observed in a follow-up).

## Deployment identity (CP5 / E3 / E5 / A1)

| Item | Value |
|------|-------|
| Code commit | `3ab120b60c39957e8d7051284a99efac2b1c7cd3` |
| Code tag | `v2026.07-ucs-hwm-v3` (src == working tree, verified) |
| Enablement commit | `0b5dd1d3583c3d2824d020ee7d6a5eadf1207f49` |
| Enablement tag | `v2026.07-ucs-hwm-v3-enabled` |
| Rollback ref (pre) | Worker `d05ffd3e-…` (F3, `v2026.07-f3-logout`) |
| Deploy #1 (code, flag off) | Worker `dbcf4c70-7936-4887-902d-7ec4aa868830` @ 19:15:59 UTC — health 200 |
| Deploy #2 (flag on) | Worker `525681a1-36c5-4b52-be3f-9a6be445a641` @ 19:22:20 UTC |
| Flag actual value (E6) | `env.UCS_HWM_COMPLETION_ENABLED ("true")` confirmed in deploy binding output |
| Bindings/cron drift (V5) | none — db/kv/r2/domain/UCS_ACTIVATION unchanged; crons `* * * * *`, `0 16 * * *` preserved |

Two-step rollout (approved plan): deploy code flag-off first (verified healthy, zero behavior
change), then enable the flag — clean separation of E5 (new version) from E6 (flag activation).

## Pre-deploy snapshot (CP2 / E1) — read-only, 19:15:32 UTC (`rows_written=0`)

| pipeline | state | lease | generation | processed | high_watermark |
|----------|-------|-------|-----------|-----------|----------------|
| `ucs-backfill-v1` | paused | **UNOWNED** | 1598 | 2212 | 3795 |
| `ucs-projection-membership-v2` | ready | **UNOWNED** | 247 | 1850 | — |
| `ucs-projection-rematerialize-v3` | running | **EXPIRED** | 108 | 529 | null |

`projection_read_enabled=0`, `cutover_epoch=1`, `dual_write_enabled=1`.

## Paused/unowned window (CP3 / E2 / V3 / A3)

No W2 checkpoint held an active (unexpired) lease owner at deploy time: backfill and membership
UNOWNED; V3 `running` with an **EXPIRED** lease (no valid owner) — the RCA-documented native
post-interruption state. Deploying therefore interrupted no in-flight run.

## Post-enable transitions (CP7 / CP8 / E7 / E8) — read-only

Observation 1 @ 19:24:31 UTC:
| pipeline | state | lease | gen | proc | high_watermark | cursor |
|----------|-------|-------|-----|------|----------------|--------|
| backfill | **ready** | UNOWNED | 1605 | 2224 | 3807 | email_id 3807 |
| membership | ready | UNOWNED | 254 | 1850 | — | — |
| V3 | paused | UNOWNED | 115 | 564 | **`2026-07-16 19:23:13|conversation:623f0b8a-…`** | `{cts:2026-07-13 03:09:10, cid:…}` |

- **Backfill → READY latched (V6/A5):** cursor 3807 == hw 3807; ≤W forward returns 0 rows.
- **V3 composite watermark frozen (V8/A7/E8):** valid `(created_at,id)` = `2026-07-16 19:23:13|conversation:623f0b8a-6320-4236-a38a-f3d0684f24c1`; cursor **reset** to the epoch start and re-materializing ≤W (currently at 2026-07-13).
- `projection_read_enabled=0` (V18/A15/E12).

Observation 2 @ 19:26:59 UTC (immutability + progression):
| pipeline | state | gen | proc | high_watermark | cursor |
|----------|-------|-----|------|----------------|--------|
| backfill | **ready** (still) | 1607 | 2224 | **3807 (unchanged)** | 3807 |
| V3 | paused | 117 | 574 | **unchanged** `2026-07-16 19:23:13|conversation:623f0b8a-…` | `{cts:2026-07-13 03:09:30}` (advanced) |

- **Backfill READY did not revert** despite continuous ingest (V7).
- **V3 watermark immutable across observations (V9);** cursor advanced monotonically within ≤W (V10); generation 115→117 via native reclaim/advance (V11). No manual actions (A14).

## Interim verification status

| ID | Requirement | Status |
|----|-------------|--------|
| V1/V2 | clean tree, tag↔src | ✅ |
| V3/A3 | paused/unowned deploy | ✅ |
| V4/A16 | health after deploy | ✅ (200) |
| V5 | no config drift | ✅ |
| V6/A5 | backfill freeze + READY | ✅ |
| V7 | READY not reverted by >W | ✅ (2 obs) |
| V8/A7 | V3 composite watermark | ✅ frozen |
| V9 | V3 watermark write-once immutable | ✅ (2 obs) |
| V10 | V3 cursor monotonic ≤W | ✅ |
| V11 | native scheduler lease lifecycle | ✅ (gen advancing, unowned between) |
| V12/A11 | no manual invocation | ✅ (native only) |
| V13/A10 | V3 READY latch | ⏳ pending V3 convergence |
| V14/A11 | parity executes | ⏳ pending V3 ready |
| V16/A12/A13 | parity PASS + integrity 0 | ⏳ pending |
| V18/A15 | reads 0% | ✅ |

## Why the verdict is IN_PROGRESS (not PASS)

V3 must re-materialize every ≤W aggregate to the current materializer version before it latches
READY and parity can execute. From processed 574 with the cursor at 2026-07-13 (W = 2026-07-16
19:23:13), and throughput bounded to ~5 rows/invocation by the 10 ms Free-plan CPU ceiling, this
is multiple hours of native scheduled convergence. Parity PASS and FULL_PRODUCTION_PASS cannot be
truthfully asserted now and are deferred to a follow-up observation (`UCS_HWM_V3_PARITY_ACCEPTANCE.md`,
`UCS_HWM_V3_FINAL_PRODUCTION_ACCEPTANCE.md`).

## Rollback (ADR-5 / A11-path) — available

- **Flag off:** set `UCS_HWM_COMPLETION_ENABLED="false"` and redeploy → legacy behavior (no data touch).
- **Worker:** `wrangler rollback dbcf4c70…` (HWM code, flag off) or `d05ffd3e…` (F3).
- No manual checkpoint/cursor/lease/outbox/projection edits; already-materialized idempotent
  projections are retained (not deleted).

## Boundaries honored

Only deploy + flag config + read-only observation. No manual checkpoint/cursor/lease/outbox/
projection edits; no manual parity injection; no rematerializer hand-invocation; reads kept 0%.
