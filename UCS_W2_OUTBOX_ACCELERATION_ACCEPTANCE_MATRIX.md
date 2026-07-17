# UCS W2 Outbox Acceleration Acceptance Matrix (design)

Mission: UCS W2 FROZEN-SNAPSHOT OUTBOX DRAIN THROUGHPUT RCA. Date: 2026-07-17. Design-only.
Tests for the future implementation mission (selected option O1: measured-safe ≤W outbox batch limit).

## Unit / integration (pool-workers, synthetic D1)

| # | Scenario | Expected |
|---|----------|----------|
| U1 | env `UCS_OUTBOX_DRAIN_LIMIT` unset | `processIngestOutbox` uses limit 2 (byte-identical default behavior) |
| U2 | env set to B (e.g. 20) | outbox `SELECT … LIMIT` uses B; up to B rows claimed/processed per call |
| U3 | backfill limit unchanged | `runWorkspace` still uses the shared `limit` (2), not B (decoupled) |
| U4 | idempotency under larger B | re-processing already-`processed`/receipted rows is a no-op; no duplicate projections |
| U5 | fencing under larger B | each row claimed via lease `UPDATE … WHERE eligible`; lost-race rows skipped |
| U6 | failure isolation | one row error → that row `failed`+5min; others in the batch still `processed` |
| U7 | ≤W scope only | only `source_message_id<=W` semantics unaffected; >W rows never pulled into parity counts |
| U8 | watermark untouched | no code path writes `high_watermark`/cursor from the outbox drain |

## Staging measurement (V15 — sets the safe B)

Seed synthetic ≤W outbox rows in `cloud-mail-staging`; for B in {2,5,10,15,20,25}: run the scheduled path
and record per-invocation `elapsedMs`, CPU (from telemetry), failure count, and rows processed. **Select the
largest B** with: elapsedMs within the scheduled-event wall budget with margin, no CPU-exhaustion, failure
rate 0, and monotone drain. Record the measured table; do not hardcode B without this evidence.

## Production acceptance (read-only, post-rollout)

| # | Check | Expected |
|---|-------|----------|
| P1 | outbox_le_w drain rate | materially > 7.2/hour (≈ 5×B/hour), monotone |
| P2 | integrity | duplicates=0, orphans=0, unresolved_failures=0, current quarantine=0 (no regression) |
| P3 | watermark | V3 composite + backfill hw unchanged |
| P4 | parity scope | unexplained still == outbox_le_w + failures≤W; >W excluded |
| P5 | reads | projection_read_enabled=0 throughout |
| P6 | rollback lever | setting the env back to 2 restores prior rate with no data change |

## Non-goals

No projection cutover, no real-iPhone, no parity forcing. This accelerates the ≤W drain only; Parity PASS
remains a native, evidence-gated outcome.
