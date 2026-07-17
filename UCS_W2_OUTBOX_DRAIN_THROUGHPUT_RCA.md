# UCS W2 Frozen-Snapshot Outbox Drain Throughput — RCA & Safe Acceleration Design

Mission: UCS W2 FROZEN-SNAPSHOT OUTBOX DRAIN THROUGHPUT RCA. Date: 2026-07-17.
**Design-only.** No code/config/schema/deploy change; all production access read-only.
Final status: **OUTBOX_THROUGHPUT_RCA_AND_DESIGN_COMPLETE.**

## Attestation

Source + read-only production inspection only (`rows_written=0` on every query). No mail body / token /
secret read (E18). No modification to Worker/config/schema/UCS state; UCS native convergence uninterrupted;
verdict remains NATIVE_RECLAIM_CONFIRMED_CONVERGENCE_IN_PROGRESS (A26).

## Primary cause (A13) — evidence-backed

**W2's ≤W outbox drains at ~7.2 rows/hour because throughput = F_eff × R_reach**, where:
- **F_eff ≈ 5 effective `unifiedConversation` invocations/hour** — measured: ~20 telemetry rows over
  19:38:29–23:43:26 (245 min), i.e. ~8% of the nominal per-minute rate; ~92% of the wall clock had no handler
  running. Driven by intermittent Cloudflare scheduled-event delivery (each handler is ~55 s and Cloudflare
  does not overlap a cron with itself, but delivery gaps dominate).
- **R_reach ≤ 2 rows/invocation** — the literal `processIngestOutbox(limit:2)` batch cap.

`5 × ~1.4 ≈ 7 ≈` observed 7.2/hour — the model closes (see `UCS_W2_OUTBOX_THROUGHPUT_MODEL.md`).

Excluded (no evidence): failures/backoff (failures=0), lease deadlock (leases UNOWNED/reclaimed), CPU
exhaustion cutoff (budgetExhausted=false in sample), corruption (integrity 0). The D1 index not leading with
tenant/workspace is a **secondary** wall-time contributor, not the batch/frequency cap.

## Root-cause decision tree (Required Output #9)

```
W2 ≤W outbox drain ~7.2/hr (design cap ~120/hr = 2×60)
├─ Scheduler delivery reaching the handler? ── PARTIAL: ~20/245min (~8%) → F_eff≈5/hr   [DOMINANT frequency limiter]
│    └─ handler wall time ~55s, no overlap; delivery gaps dominate (92% idle)
├─ Handler entry / stage order? ── unifiedConversation awaited FIRST; scope loop W1 then W2 (ORDER BY workspace_id)
│    └─ W1 (live, V3 running/ACTIVE) runs full chain before W2 → adds to 55s, occasional W2 non-reach
├─ Outbox reachable each event? ── usually yes when handler runs (W2 outbox is first in W2's scope iter)
├─ Batch limit? ── LIMIT 2 (processIngestOutbox limit:2)                                  [DOMINANT per-invocation cap]
├─ Rows need multiple invocations? ── no, unless transient error → 5-min lease backoff (failures=0 now)
├─ Retry/backoff / eligibility? ── 5-min lease clock only; negligible (no failures)
├─ Provider / auth gate? ── none in ≤W drain (local materialize)
├─ CPU ceiling before outbox? ── not the active cutoff (budgetExhausted=false; wall time dominates)
├─ D1 query/index? ── idx_ucs_ingest_pending(state,lease_until,created_at) lacks leading tenant/workspace
│    └─ inflates per-query wall time → part of the 55s; secondary, not the cap
├─ Lease duty cycle? ── LEASE_SECONDS=60 / +5min; UNOWNED between runs; not limiting
└─ PRIMARY = (intermittent delivery ⇒ F_eff≈5/hr) × (batch limit 2). Both small; product = the bottleneck.
```

## Product Decision (Required Output #10) — SINGLE path

**Raise the ≤W outbox drain batch limit** via a dedicated env `UCS_OUTBOX_DRAIN_LIMIT` (default 2 ⇒ unchanged),
consumed only by `processIngestOutbox`, decoupled from the shared backfill `limit`, with **B set by staging
measurement** (candidate 10–25) and flag-gated rollback. Rationale: highest leverage-per-risk, single
consumer (no double-consume), preserves every frozen-snapshot/idempotency/fencing/parity invariant, reversible
by env. Rejected: stage reorder, dedicated trigger/Queue, V3/outbox split, D1 index (needs migration),
NO_CHANGE. Details: `UCS_W2_SAFE_ACCELERATION_OPTIONS.md`, `docs/ADR-UCS-W2-OUTBOX-DRAIN-THROUGHPUT.md`.

Projected effect: B=20 ⇒ ~100/hour ⇒ ETA ~16 h (vs ~225 h); measured B is authoritative.

## Audit answers (mission)

1. Outbox consumer entry: `index.js scheduled` → `unifiedConversation` step → `monitorScheduled` →
   per-scope `processIngestOutbox`.
2. Stage position: inside the FIRST awaited step; within it, W2 is the 2nd scope (after W1).
3. Awaited stages before W2 outbox: the entire W1 scope chain (outbox+backfill+membership+V3+mission+parity).
4. Reachable every event? Only when the handler actually runs (~8% of nominal minutes); usually reaches W2 when it does.
5. Design batch limit: 2 (per-minute path).
6. Attempted rows/invocation: ≤2.
7. Processed rows/invocation: ≤2 (observed avg ~1.4).
8. Multiple invocations per row? No, unless a transient failure defers it 5 min (failures=0 now).
9. Retry/backoff? 5-min lease clock on failure; no exponential backoff.
10. Eligibility delay? Only the lease clock; negligible now.
11. Provider/auth gate? None in the ≤W drain.
12. Scheduler gaps reduce execution to ~8% of nominal (~20/245 min).
13. Lease lifecycle: not duty-cycle-limiting (UNOWNED between runs; reclaim works).
14. CPU ceiling exhausted before outbox? Not evidenced (budgetExhausted=false; wall time dominates).
15. D1 index match? Partial — index lacks leading tenant/workspace; secondary cost.
16. Why ~7.2/hour? F_eff≈5/hr × batch≤2 ≈ 7/hr.
17. Primary cause: intermittent scheduler delivery × batch-limit-2 (product).
18. Excluded: failures, backoff, lease deadlock, CPU cutoff, corruption.
19. Recommended single path: measured-safe ≤W outbox batch raise (env, flag-gated).
20. Preserves HWM/Parity: only per-invocation row count changes; watermark/scope/receipts/fencing untouched.
21. Prevent double-consume: single consumer unchanged (no new trigger/queue).
22. Staging verification: synthetic ≤W outbox B-sweep measuring elapsedMs/CPU/failures/rows.
23. Prod stop conditions: wall-limit approach, CPU exhaustion, any failure/dup/orphan/quarantine, watermark/cursor change, scope leak.
24. Rollback without editing UCS state: set env back to 2 / Worker rollback; no data change.
25. Any code/config/schema/prod change this mission? No.
26. UCS verdict still convergence-in-progress? Yes.
27. Next mission authorization: design accepted; implement `UCS_OUTBOX_DRAIN_LIMIT` with staging measurement, then UCS-coordinated prod set — preserving all invariants.

## Verdict

**OUTBOX_THROUGHPUT_RCA_AND_DESIGN_COMPLETE** — real processing chain explained, observed-vs-design gap
quantified, factors decomposed, single evidence-backed primary cause identified, one safe acceleration
selected with staging/rollout/rollback/acceptance defined. No code/config/schema/production change; UCS
convergence uninterrupted. Not FIXED / DEPLOYED / PARITY_PASS / FULL_PRODUCTION_PASS.
