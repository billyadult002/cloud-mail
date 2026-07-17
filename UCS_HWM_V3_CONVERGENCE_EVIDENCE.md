# UCS HWM V3 Convergence Evidence (production, read-only)

Mission: UCS HWM V3 CONTROLLED PRODUCTION ACTIVATION … Date: 2026-07-16
Status: convergence IN PROGRESS. All samples SELECT-only (`rows_written=0`), native scheduler.

## Timeline of read-only observations (UTC)

| time | pipeline | state | gen | proc | high_watermark | cursor |
|------|----------|-------|-----|------|----------------|--------|
| 19:15:32 (pre) | backfill | paused/unowned | 1598 | 2212 | 3795 | — |
| 19:15:32 (pre) | V3 | running/expired | 108 | 529 | null | — |
| 19:24:31 | backfill | ready/unowned | 1605 | 2224 | 3807 | email_id 3807 |
| 19:24:31 | V3 | paused/unowned | 115 | 564 | `2026-07-16 19:23:13\|conversation:623f0b8a-6320-4236-a38a-f3d0684f24c1` | cts 2026-07-13 03:09:10 |
| 19:26:59 | backfill | ready | 1607 | 2224 | 3807 | email_id 3807 |
| 19:26:59 | V3 | paused | 117 | 574 | `2026-07-16 19:23:13\|conversation:623f0b8a-…` (unchanged) | cts 2026-07-13 03:09:30 |
| 19:37:43 | backfill | ready/unowned | 1618 | 2224 | 3807 (unchanged) | email_id 3807 |
| 19:37:43 | V3 | paused/unowned | 128 | 629 | `2026-07-16 19:23:13\|conversation:623f0b8a-…` (unchanged) | cts 2026-07-13 03:15:11 |

## Parity + integrity observation @ 19:37:43 UTC (read-only, rows_written=0)

Worker `525681a1`, flag on. `projection_read_enabled=0`, epoch 1.

- **Native parity IS executing** (backfill+membership READY open the gate). Latest rows evaluate
  backfill watermark **hw=3807** (same frozen snapshot, V15/E13) across all surfaces:
  `missing` 0 (attachments 5), `extra` 0, **`contentMismatch` 1350**, **`unexplained` 1658**,
  **`passed` 0** on every surface — the expected in-progress state.
- Integrity: **duplicate_conversations=0, orphan_projections=0, unresolved_failures=0** (A9/A10/V11).
- `unexplained` driver: **outbox_le_w = 1655** (≤W ingest-outbox not yet processed) + failures 0.

## Two convergence long-poles (evidence-based)

Parity PASS requires BOTH to reach 0, each draining natively under the 10 ms CPU ceiling:
1. **contentMismatch 1350 → 0** — V3 re-materialization of ≤W aggregates to current materializer
   version (~5 rows/invocation; ~2100 ≤W aggregates ⇒ multiple hours).
2. **unexplained 1658 → 0** — ≤W ingest-outbox drain via `processIngestOutbox` (limit 2/invocation
   in the per-minute path; ~1655 events ⇒ ~14 h). This is the slower long-pole. New mail is >W and
   excluded, so this is a fixed, draining set.

No corruption, no manual action; both backlogs are strictly ≤W and converging monotonically.

## Convergence ledger — full columns (read-only, rows_written=0)

Worker `525681a1`, flag `UCS_HWM_COMPLETION_ENABLED=true`, `projection_read_enabled=0` throughout.

| UTC | pipe | state | lease | gen | proc | high_watermark | cursor | contentMismatch | outbox_le_w | unexplained | missing | dup | orphan | failures | quar | passed |
|-----|------|-------|-------|-----|------|----------------|--------|-----------------|-------------|-------------|---------|-----|--------|----------|------|--------|
| 19:37:43 | V3 | paused | unowned | 128 | 629 | `…19:23:13\|623f0b8a` | cts 2026-07-13 03:15:11 | 1350 | 1655 | 1658 | 5(att)/0 | 0 | 0 | 0 | v3=0 bf=24 | 0 |
| 19:43:25/53 | V3 | paused | unowned | 132 | 649 | `…19:23:13\|623f0b8a` (unchanged) | cts 2026-07-13 03:20:14 | **1336** | **1650** | **1650** | (n/a this pull) | 0 | 0 | 0 | v3=0 bf=24 | 0 |

Backfill both times: `ready / unowned / hw=3807 / cursor=3807 / quar=24`. Membership: `ready / unowned`.

## Trend & scope analysis (E10/E11/E12/E13)

- **contentMismatch 1350 → 1336** (monotonic ↓) — consistent with V3 re-materializing ≤W aggregates
  (proc 629→649, cursor 03:15:11→03:20:14). E10/V9/V20-trend satisfied.
- **outbox_le_w 1655 → 1650** (monotonic ↓) — native `processIngestOutbox` drain. E11/V10/V22-trend.
  Observed drain rate this window is low (~1/min), so the ≤W outbox is the dominant long-pole.
- **Scope split (E12/V11):** at 19:43 `outbox_global=1677 = outbox_le_w 1650 + outbox_future_gt_w 27`.
  The 27 are new emails with `email_id>3807` — future-epoch data, correctly **excluded** from the
  frozen snapshot and NOT counted in `unexplained`.
- **unexplained 1650 == outbox_le_w 1650 + failures 0** (E13/V13) — unexplained is exclusively the
  same ≤W snapshot's outbox+failures; no >W leakage.
- Integrity flat: duplicates=0, orphans=0, unresolved_failures=0 across observations (V14–V17).

## Long-interval checkpoint — 2026-07-17 00:15–00:17 UTC (read-only, rows_written=0)

Verdict: **NATIVE_RECLAIM_CONFIRMED_CONVERGENCE_IN_PROGRESS**.

| field | value |
|-------|-------|
| observation UTC | 2026-07-17 00:15–00:17 |
| previous valid observation | 2026-07-16 19:48:18 (metric baseline 19:43:53) |
| elapsed interval | ~266 min (~4h27m) — interval gate ≥1h satisfied |
| production Worker | `525681a1` (reconciled — see note; the authorized version, active) |
| HWM flag | `UCS_HWM_COMPLETION_ENABLED=true` |
| projection_read_enabled / rollout | 0 / 0% |
| latest scheduled telemetry | audit **2934** @ 2026-07-16 23:43:33 UTC (advanced from 2821 @ 19:41:26 — telemetry recovered) |
| telemetry continuity | 2821→2934 (+113 rows) since the 19:41 gap ⇒ native reclaim confirmed; a fresh ~33-min gap at observation (23:43→00:17) is another intermittent window, not a blocker |
| Backfill | ready / UNOWNED / hw=3807 / cursor=3807 / gen 1638 / proc 2224 / lifetime-quar 24 |
| Membership | ready / UNOWNED |
| V3 | paused / UNOWNED / gen **148** / proc **729** / hw `2026-07-16 19:23:13\|conversation:623f0b8a-…` (unchanged) / cursor cts **2026-07-13 03:39:55** |
| contentMismatch | **1261** (was 1336) |
| outbox_global / le_w / future_gt_w | 1663 / **1618** / 45 (1663 = 1618 + 45) |
| unexplained | **1618** (== outbox_le_w 1618 + unresolved_failures 0) |
| missing (attachments) | 5 |
| duplicates / orphans / unresolved_failures | 0 / 0 / 0 |
| current unresolved quarantine | 0 (lifetime counter: backfill 24, V3/membership 0) |
| parity passed / parity hw / materializer | 0 / 3807 / (per MATERIALIZER_VERSION) |

**Native reclaim confirmed (ADR-3/ADR-6):** telemetry advanced 2821→2934, and V3 gen 132→148,
processed 649→729, cursor 2026-07-13 03:20:14 → 03:39:55 (monotonic, within ≤W). Watermark immutable
(ADR-5). Backfill READY latched at 3807 (no revert). Integrity intact. The 19:41 gap self-resolved
via native reclaim — not a blocker (V21: a single gap is insufficient for BLOCKED).

**Drain rates (vs 19:43:53 baseline, ~271 min) & revised window (E7):**
- V3 processed: 0.295/min (~17.7/hr).
- contentMismatch: 0.277/min → 0 in ~76 h.
- outbox_le_w / unexplained: **0.118/min → 0 in ~228 h (~9.5 days)** — the dominant long-pole, well
  below the 2/invocation cap due to intermittent scheduler gaps. At observed rates, native parity PASS
  is on the order of **~1 week+** out (bounded by the ≤W outbox drain), absent any throughput change
  (which is out of scope).

**Worker-version reconciliation:** an initial `deployments list | grep -A2 '100%' | head -1` returned
`42a6ebe3` (a chronologically-earlier deployment block), which momentarily looked like an unregistered
Worker change. A definitive re-read of the list tail shows the newest/active deployment is `525681a1`
(2026-07-16 19:22:33, author saercpku) — the authorized version. No unregistered production change;
the earlier value was a grep artifact, disclosed here for auditability.

## Observation 19:47:46 / 19:48:18 UTC — scheduler telemetry gap (read-only, rows_written=0)

| field | value |
|-------|-------|
| Worker / flag / proj_read | `525681a1` / true / 0% |
| backfill | ready / UNOWNED / hw=3807 / cursor=3807 / gen 1622 / proc 2224 / lifetime-quar 24 |
| membership | ready / UNOWNED |
| V3 | paused / UNOWNED / gen 132 / proc 649 / hw `2026-07-16 19:23:13\|conversation:623f0b8a-…` (unchanged) / cursor cts 2026-07-13 03:20:14 |
| contentMismatch | 1336 (unchanged vs 19:43) |
| outbox_global / le_w / future_gt_w | 1677 / 1650 / 27 (1677 = 1650 + 27) |
| unexplained | 1650 (== outbox_le_w + failures 0) |
| missing (attachments) | 5 |
| duplicates / orphans / unresolved_failures | 0 / 0 / 0 |
| unresolved quarantine (current) | 0 (lifetime counter: backfill 24, V3/membership 0) |
| parity passed | 0 |

**Scheduler-gap classification (V26 / ADR-6):** latest `runtime_telemetry` audit is id **2821 @
19:41:26 UTC**; at 19:48:18 that is a ~7-minute gap, which is why V3 gen/proc/cursor and all parity
metrics are unchanged since ~19:43. Disposition:
- Not a blocker. Leases are UNOWNED (no stuck ACTIVE lease, no takeover needed); watermark immutable;
  cursor not regressed; duplicates/orphans/failures still 0 (no invariant violation).
- This matches the RCA-documented intermittent Cloudflare scheduled-event gaps (e.g. the earlier
  13:31→13:49 gap) that resume via **native reclaim** on a subsequent cron. Manual lease action is
  forbidden and was not taken.
- Per V27, BLOCKED_WITH_EVIDENCE requires *sustained* non-progress or an invariant violation; a
  single ~7-min gap is neither. Verdict remains PRODUCTION_CONVERGENCE_IN_PROGRESS. Next bounded
  observation (after a longer interval) should confirm native reclaim resumed progress.

## Evidence claims

- **E7 backfill READY:** state=ready at cursor==hw==3807; latched across two observations, not
  reverted by continuous ingest (>3807 mail).
- **E8 V3 watermark first-freeze + immutability:** composite `(created_at,id)` frozen at
  `2026-07-16 19:23:13|conversation:623f0b8a-6320-4236-a38a-f3d0684f24c1`; identical across
  19:24:31 and 19:26:59 → write-once, not raised by ingest (V9).
- **E9 V3 native advance:** generation 108→115→117 (reclaim/advance), processed 529→564→574,
  cursor cts 2026-07-13 03:09:10 → 03:09:30 monotonic within ≤W (V10). Checkpoints UNOWNED between
  runs → native lease acquire/renew/release/reclaim (V11), no manual actions (V12/A14).
- **Cursor reset semantics:** V3 cursor moved from a pre-enable id-cursor to composite start and is
  re-materializing ≤W from the earliest `created_at` forward — i.e. all ≤W aggregates will be
  brought to the current materializer version (idempotent via receipts/supersedes).

## Remaining convergence (to be observed in follow-up)

- E10 (≤W current-materializer coverage complete), V13 (V3 READY latch): pending — V3 must advance
  cts from 2026-07-13 to W=2026-07-16 19:23:13 at ~5 rows/invocation (hours).
- Then parity executes natively (E11) and must satisfy all-zero integrity (V16).

## >W handling (ADR-4 / A9)

Aggregates created after W (`created_at > 2026-07-16 19:23:13`, or `= AND id > W_id`) are excluded
from this epoch's scope and are neither processed nor lost — they remain eligible for a subsequent
epoch. Backfill's frozen W=3807 likewise excludes newer email ids from the current completion set.
