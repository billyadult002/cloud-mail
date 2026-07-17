# UCS W2 Outbox Throughput Model (read-only analysis)

Mission: UCS W2 FROZEN-SNAPSHOT OUTBOX DRAIN THROUGHPUT RCA. Date: 2026-07-17. Design-only.

## Observed (ADR-1 / A1)

- outbox_le_w: 1650 → 1618 over ~271 min ⇒ **−32 rows ⇒ ~7.2 rows/hour**.
- ETA to 0 at observed rate: 1618 / 7.2 ≈ **~225 hours (~9.4 days)** — dominant Parity-PASS long-pole.

## Model

`drain_per_hour = F_eff × R_reach`, where
- `F_eff` = effective `unifiedConversation` invocations per hour ≈ **~5/hour** (20 in 245 min; measured).
- `R_reach` = W2 outbox rows moved to `processed` per invocation that reaches the W2 outbox stage ≤ **2**
  (the `limit=2` batch cap; observed avg ~1.4).

`5 × 1.4 ≈ 7.0/hour` ≈ observed 7.2/hour. The model closes.

## Factor decomposition (V6 — quantified contributions)

| Factor | Evidence | Contribution to the low rate |
|--------|----------|------------------------------|
| **Scheduler delivery frequency** | ~20 invocations in 245 min (~8% of nominal); ~92% idle | **Dominant frequency limiter** — caps `F_eff` at ~5/hour |
| **Batch limit = 2** | `processIngestOutbox(limit:2)` from index.js:300 | **Dominant per-invocation cap** — caps `R_reach` at 2 |
| Per-invocation wall time ~55 s | telemetry `elapsedMs≈55k` | Prevents back-to-back sub-minute runs; minor vs delivery gaps (idle dominates) |
| W1-first sequential ordering | scope loop `ORDER BY workspace_id`; W1 live + V3 running | Adds W1 work ahead of W2; contributes to the 55 s and occasional non-reach of W2 |
| CPU ceiling | budgetExhausted=false in sample | Not the active cutoff here (wall/frequency dominate) |
| Row eligibility / backoff | 5-min lease on failures; failures=0 | Negligible now (no failures ⇒ no backoff deferrals) |
| Retries | attempt_count increments; failures=0 | Negligible |
| D1 query/index cost | index `idx_ucs_ingest_pending(state,lease_until,created_at)` does NOT lead with tenant/workspace | Secondary — inflates per-query wall time (part of the 55 s), not the batch/frequency cap |
| Lease duty cycle | LEASE_SECONDS=60, +5min renew; leases UNOWNED between runs | Not limiting (reclaim works; no deadlock) |

## Primary cause (A13)

The ≤W outbox drains at ~7.2 rows/hour because throughput = **(intermittent scheduler delivery ⇒ ~5
effective invocations/hour) × (hard batch limit of 2 rows/invocation)**. Both are small; their product is
the cap. The batch limit is the **directly and safely tunable** lever; scheduler delivery is a Cloudflare
platform characteristic. No failure, corruption, lease deadlock, or CPU-exhaustion cutoff is responsible
(all excluded by evidence).

## Sensitivity (what a safe change would buy)

- Raising the ≤W outbox batch to **B** (measured-safe) makes `R_reach ≤ B` ⇒ drain ≈ `5 × B/hour`.
  - B=10 ⇒ ~50/hour ⇒ ETA ~32 h. B=20 ⇒ ~100/hour ⇒ ETA ~16 h. B=25 ⇒ ~125/hour ⇒ ETA ~13 h.
  - Larger B lengthens per-invocation wall time; since the handler is ~92% idle, added wall time is cheap
    until it risks the scheduled-event wall limit or reduces `F_eff` — the staging measurement sets the ceiling.
- Raising `F_eff` (dedicated trigger/queue) is higher-leverage but higher-risk/complexity (new infra +
  double-consumption risk). Deferred as the rejected alternative.
