# UCS W2 Scheduled Runtime Budget Map (read-only)

Mission: UCS W2 FROZEN-SNAPSHOT OUTBOX DRAIN THROUGHPUT RCA. Date: 2026-07-17. Design-only.

## Per-invocation stage order (per-minute cron) — E9/E10

`index.js scheduled()`: **`unifiedConversation` is awaited FIRST** (blocks), then a `Promise.allSettled`
of gmailSync/outboundDrain/echartsCache/nexoraAutonomy/durableMissionRuntime/classificationIntelligence.
Each is wrapped by `runtimeTelemetryService.wrapStep` (records `elapsedMs`, `budgetExhausted`, `ok`,
swallows errors → not fail-fast). The ≤W outbox drain lives INSIDE `unifiedConversation`
(`monitorScheduled` → per-scope `processIngestOutbox`), so it is gated by that first step.

## Measured runtime (read-only telemetry, 19:38:29–23:43:26 UTC, ~245 min)

| metric | value |
|--------|-------|
| `unifiedConversation` telemetry rows | **~20** (nominal per-minute would be ~245 ⇒ ~8% effective frequency) |
| `unifiedConversation` `elapsedMs` (parsed sample) | **54,564 / 55,697 / 57,043 ms (~55 s wall)** |
| `budgetExhausted` (parsed sample) | false |
| total handler runtime | ~20 × 55 s ≈ **~18 min busy out of 245 min (~92% idle)** |

Note: 17/20 metadata_json rows were truncated at the 4000-char audit cap (large `results`), so per-scope
`live.processed` could not be summed for all; the 3 parsed showed W2 `live.processed=0` (small-result cycles).
`elapsedMs` and counts are authoritative.

## Budget interpretation (E5 / ADR-5)

- **CPU vs wall vs I/O:** D1 queries are I/O (wall time), not CPU. The ~55 s `elapsedMs` is dominated by
  serial D1 round-trips across W1+W2 (outbox + backfill + membership(25) + V3(5) + mission + parity per scope).
  The "10 ms Free-plan CPU ceiling" comment refers to CPU; the observed limiter here is **wall-time per
  invocation + scheduler delivery frequency**, not a CPU-exhaustion cutoff (budgetExhausted=false in sample).
- **`createWorkerBudget`** (worker-budget.js: default maxMs 25,000, maxItems 10) exists but the ≤W outbox
  loop uses a plain `LIMIT 2`, not this budget; so the outbox per-invocation cap is the literal `limit=2`.
- **Effective frequency** is the dominant factor: ~20 invocations / 245 min ≈ **one every ~12 min**, i.e.
  ~5/hour. Cloudflare does not overlap a cron handler with itself, and delivery is intermittent (the
  previously-RCA'd scheduled-event gaps), so most nominal minutes execute nothing.

## Throughput identity

`W2 outbox drain/hour ≈ (effective invocations/hour that reach W2 outbox) × (rows processed per reach ≤ 2)`.
Observed 7.2/hour ≈ ~5 invocations/hour × ~1.4 rows each (near the 2-cap). Both factors are small; their
product is the bottleneck. See the throughput model.
