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
