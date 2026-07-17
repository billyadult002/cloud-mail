# ADR: UCS W2 Outbox Drain Acceleration Implementation

Status: Implemented locally; staging verification pending.

`UCS_OUTBOX_DRAIN_LIMIT` controls only the per-invocation `processIngestOutbox`
limit. It defaults to 2, preserving the existing production behavior when unset.
It accepts positive integers and clamps to 25; invalid/missing/fractional values
fall back to 2. The setting does not affect backfill, membership, V3, parity,
scope order, scheduler cadence, CPU budget, leases, fencing, receipts, digests,
or frozen-watermark semantics.

Success still means a real materialization followed by the existing processed
transition. Lease claim/renewal, owner/generation conditions, retry/failure,
and idempotency behavior remain in `processIngestOutbox` unchanged.

The staging candidate plan is 2/10/15/20/25. A candidate requires comparable
structured evidence for processed rows, elapsed time, budget, failures,
duplicates, lease lifecycle, D1 errors, scheduler completion, and downstream
integrity. No candidate is recommended until that evidence exists. Rollback is
configuration deletion/reset to 2 or Worker-version rollback; it never edits
outbox, checkpoints, cursors, leases, or projections.
