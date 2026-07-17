# ADR: UCS W2 Outbox Drain Throughput — RCA & Acceleration Decision

Status: Proposed (design-only; implementation is a separate mission).
Date: 2026-07-17.
Related: `UCS_W2_OUTBOX_DRAIN_THROUGHPUT_RCA.md`, `UCS_W2_SCHEDULED_RUNTIME_BUDGET_MAP.md`,
`UCS_W2_OUTBOX_PROCESSING_CALL_GRAPH.md`, `UCS_W2_OUTBOX_THROUGHPUT_MODEL.md`,
`UCS_W2_SAFE_ACCELERATION_OPTIONS.md`, `UCS_W2_OUTBOX_ACCELERATION_ACCEPTANCE_MATRIX.md`,
`UCS_W2_OUTBOX_ACCELERATION_ROLLOUT_PLAN.md`.

## ADR-1 — Observed throughput

outbox_le_w 1650→1618 over ~271 min ⇒ ~7.2 rows/hour ⇒ ETA to 0 ≈ ~225 h (~9.4 days). Dominant Parity-PASS long-pole.

## ADR-2 — Call chain

cron → `index.js scheduled` → awaited `unifiedConversation` step → `monitorScheduled` → per-scope
`processIngestOutbox` (LIMIT 2) → outbox rows `pending→processing→processed`. Full graph in the call-graph doc.

## ADR-3 — Stage ordering

`unifiedConversation` is awaited first; inside, the scope loop is `ORDER BY workspace_id` so W1 runs its full
chain before W2. W1 is live (`projection_read_enabled=1`) with `ucs-projection-rematerialize-v3` running/ACTIVE,
so it consumes wall time ahead of W2 each invocation.

## ADR-4 — Config/source facts

per-invocation outbox limit = 2; LEASE_SECONDS=60, +5-min renew on claim/failure; failure ⇒ state `failed`
+5-min lease (backoff); no exponential backoff; no attempt cap in the drain; success ⇒ `processed` (real
materialize only); eligibility = `state IN ('pending','failed','processing')` AND lease expired/null.

## ADR-5 — CPU vs wall vs delivery

Measured `unifiedConversation` `elapsedMs≈55 s` (wall, D1 I/O bound), `budgetExhausted=false`. The 10 ms
Free-plan **CPU** ceiling is not the active cutoff; the limiter is **wall time per invocation + intermittent
scheduled-event delivery** (~20 invocations / 245 min ≈ 8%).

## ADR-6 — Frozen-snapshot invariants (any change must preserve)

≤W only; >W excluded from current parity; idempotency (receipts + digest keys + supersedes); lease fencing;
`processed` only from real success; no fabricated completion.

## ADR-7 — Options & decision

Evaluated: raise ≤W batch (O1), reorder stage (O2), dedicated trigger (O3), Queue consumer (O4), split V3/outbox
(O5), D1 index (O6), NO_CHANGE (O7). **Decision: O1** — a dedicated env `UCS_OUTBOX_DRAIN_LIMIT` (default 2)
consumed only by `processIngestOutbox`, with B chosen by staging measurement, flag-gated.

## ADR-8 — Why others rejected

O2/O5 reorder/restructure a correctness-sensitive shared pipeline (W1 live + ingest + V3 + parity). O3/O4 add
infra + a double-consumption hazard for the same goal at higher cost. O6 needs a migration (out of scope) and
only trims wall time. O7 unjustified — O1 is a safe, reversible, invariant-preserving win.

## ADR-9 — Rollout/rollback safety

Config-as-code `[vars]` set + deploy in a UCS-coordinated paused/unowned window; provenance recorded. Rollback
= set env back to 2 / `wrangler rollback` — no data change; watermark/cursor/receipts/projections untouched;
HWM readiness latch, parity scope, and reads=0% preserved.

## ADR-10 — Design-only

This mission performed no code/config/schema/production change and declares nothing FIXED/DEPLOYED/VERIFIED.
Status: OUTBOX_THROUGHPUT_RCA_AND_DESIGN_COMPLETE.
