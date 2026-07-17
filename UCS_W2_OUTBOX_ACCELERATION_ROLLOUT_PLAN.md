# UCS W2 Outbox Acceleration Rollout & Rollback Plan (design)

Mission: UCS W2 FROZEN-SNAPSHOT OUTBOX DRAIN THROUGHPUT RCA. Date: 2026-07-17. Design-only.
Nothing here is executed by this mission. Implementation is the separate next mission.

## Rollout (selected option O1)

1. Implement a dedicated env bound `UCS_OUTBOX_DRAIN_LIMIT` (default 2) consumed only by
   `processIngestOutbox`'s `LIMIT`, decoupled from the shared `runWorkspace` limit.
2. Unit/integration tests U1–U8 green in CI (pool-workers).
3. **Staging measurement** to pick the safe B (acceptance matrix): deploy to `cloud-mail-staging`, seed
   synthetic ≤W outbox, sweep B, record elapsedMs/CPU/failure/rows, select the largest safe B.
4. Production: set `UCS_OUTBOX_DRAIN_LIMIT=B` via wrangler `[vars]` (config-as-code, committed) and deploy
   during a W2 paused/unowned window, coordinated with the UCS monitor (a redeploy re-registers cron; avoid
   interrupting an in-flight invocation). Record Commit/Tag/Worker Version in `DEPLOYMENT_PROVENANCE_REPORT.md`.
5. Observe (read-only, long-interval) that outbox_le_w drain rate rose to ≈5×B/hour with integrity intact.

## Stop conditions → rollback (V14 / A17 / A18)

Halt and roll back if any: per-invocation elapsedMs approaches the scheduled-event wall limit; CPU exhaustion
/ budgetExhausted spikes; any failure/duplicate/orphan/quarantine appears; watermark or cursor changes;
Backfill READY reverts; unexplained stops equalling ≤W outbox+failures (scope leak). Rollback = set
`UCS_OUTBOX_DRAIN_LIMIT=2` and redeploy (or `wrangler rollback` to the prior Worker) — **no data change**,
watermark/cursor/receipts/projections untouched, current legitimate progress preserved (ADR-9).

## Invariance guarantees (A15)

The change alters only how many ≤W outbox rows are attempted per invocation. It does not touch the frozen
watermark, HWM readiness latch, idempotency receipts, digest keys, lease fencing, parity scope, or the
projection-read boundary. Larger B cannot introduce >W rows (the ≤W predicate is unchanged) or fabricate
`processed` (only real materialize success sets it).

## UCS / cross-work isolation

Must not touch UCS checkpoint/watermark/cursor/lease/outbox-state/projection/parity/flag beyond the batch
env, must not enable projection reads, must not be merged with F4/F2/F5/F6. Ordering: this acceleration is
optional and only accelerates convergence; if not pursued, the NEXT_IF_NO_CHANGE path (long-interval
convergence checkpoints) continues unchanged.

## Next Implementation Mission (prepared, not started)

**UCS W2 OUTBOX DRAIN THROUGHPUT IMPLEMENTATION AND STAGING VERIFICATION** — implement `UCS_OUTBOX_DRAIN_LIMIT`
(default 2), U1–U8 tests, staging B-sweep measurement, then a UCS-coordinated production `[vars]` set +
deploy with provenance and read-only rate verification. Entry condition: this design accepted; UCS remains
in convergence (no need to wait for Parity PASS, since faster drain *helps* reach it). Must preserve all
invariants above.
