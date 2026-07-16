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
