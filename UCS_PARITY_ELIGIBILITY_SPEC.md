# Parity Eligibility Specification (High-Watermark)

Mission: UCS HIGH-WATERMARK COMPLETION AND PARITY ENABLEMENT (design only)
Date: 2026-07-16
Target (implementation mission): `unified-conversation-backfill-service.js` `monitorScheduled:102`, `parityWorkspace:74–95`.

## Current gate (evidence)

- `monitorScheduled:102`: `if (run.ready && membership.ready) run.parity = parityWorkspace(...)`.
- `parityWorkspace:75`: requires backfill checkpoint `state='ready'`, else `{passed:false, reason:'backfill_not_ready'}`.
- Coverage (`:76`) is watermark-scoped (`e.email_id <= cp.high_watermark`, `m.source_message_id <= cp.high_watermark`).
- **Defect:** `failures` (`resolved_at IS NULL`) and `outbox` (`state!='processed'`) are **not**
  watermark-scoped; `unexplained = failures + outbox` (`:76`) is inflated by live growth > W,
  so parity's pass condition (`:92`, `unexplained==0`) is unreachable under ingest.

## New eligibility predicate

Parity for epoch W is **eligible** when ALL hold:

1. `checkpoint(ucs-backfill-v1).state == 'ready'` AND its `high_watermark == W` (latched, immutable).
2. `membership.ready` at a watermark ≥ W (membership refresh has covered all conversations whose
   source ≤ W).
3. V3 rematerialization `state == 'ready'` at its frozen watermark ≥ W (so projections reflect ≤W).

Parity **passes** at W when every count below is 0, each scoped to records ≤ W:

| Metric | Current predicate | New (≤W-scoped) predicate |
|--------|-------------------|---------------------------|
| coverageMissing | `legacy(≤W) − covered(≤W)` | unchanged (already ≤W) |
| missing / extra | id-set diff (≤W surfaces) | unchanged (surfaces derive from ≤W watermark) |
| contentMismatch | projection vs aggregate (all current) | add `AND p.conversation_id` source ≤ W (only ≤W projections) |
| **failures** | `resolved_at IS NULL` (ALL) | `AND source_ref maps to a record ≤ W` (join to email/aggregate ≤ W) |
| **outbox** | `state!='processed'` (ALL) | `AND source_message_id ≤ W` (only ≤W ingest events) |
| unexplained | failures + outbox (ALL) | failures(≤W) + outbox(≤W) |

Because all inputs are bounded by the immutable W, the parity computation is a **pure function
of a frozen snapshot** — reproducible, TOCTOU-free, and re-runnable to the same verdict.

## Why parity is now safe (V4)

- **Determinism:** legacy(≤W), covered(≤W), and surface id-sets are fixed once W is frozen;
  re-running parity yields the same `missing/extra/content` regardless of concurrent ingest.
- **No live interference:** outbox/failures for records > W are excluded, so ongoing Gmail sync
  cannot flip a passed verdict to fail.
- **Fencing preserved:** parity reads only; it writes a single `conversation_projection_parity`
  row keyed by `(tenant,workspace,surface,epoch,watermark)` (`:93`) — idempotent per epoch.

## Verdict semantics

- `passed=1 at W` ⇒ "W2 projections are parity-consistent with the legacy ledger for all
  records ≤ W." This is the per-epoch completion evidence consumed by FULL_PRODUCTION_PASS
  evaluation (a **separate** later mission; parity passing does NOT auto-enable projection reads).
- Records in (W, +∞) are explicitly out of this verdict and are covered by the next epoch's parity.

## Non-goals / boundaries

This spec runs **no** parity, enables **no** projection reads, and modifies **no** production
state. It defines when the runtime *would* become eligible once the design is implemented.
