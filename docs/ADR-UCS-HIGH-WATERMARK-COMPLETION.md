# ADR: UCS High-Watermark Completion & Parity Enablement

Status: Proposed (design approved for the implementation mission)
Date: 2026-07-16
Scope: design only — no code change, no deploy, no production mutation.
Related: `UCS_HIGH_WATERMARK_COMPLETION_REPORT.md`, `UCS_HIGH_WATERMARK_DESIGN_SPEC.md`,
`UCS_PARITY_ELIGIBILITY_SPEC.md`, `UCS_COMPLETION_STATE_MACHINE.md`,
`UCS_HIGH_WATERMARK_ACCEPTANCE_MATRIX.md`, `UCS_HIGH_WATERMARK_ROLLOUT_PLAN.md`,
`UCS_W2_COMPLETION_BLOCKER_SOURCE_RCA.md`.

## ADR-1 — Why global-quiescence completion fails

The current completion equates "done" with "no remaining records":
`runWorkspace.ready = rows.length < remaining` (`unified-conversation-backfill-service.js:66`),
and parity is gated on that readiness (`:102`). `conversation_aggregates` and
`conversation_ingest_outbox` grow with every minute of Gmail ingest, so `remaining` is
never zero, `ready` never latches (a `ready` checkpoint is even re-claimable, `:17`), and
parity never runs. `parityWorkspace` compounds this: its `unexplained = failures + outbox`
(`:76`) is not watermark-scoped, so live growth blocks parity even if the ≤W backfill is
complete. Under continuous production ingest this model is **provably non-terminating**.

## ADR-2 — Snapshot-based (high-watermark) completion model

Define completion per immutable snapshot boundary **W**:

`Completed(W) = ( every record with ordering-key ≤ W has a current projection ) ∧ Parity(W).passed`

- **W** is captured once at epoch open and never mutated (stored in the existing
  `conversation_materialization_checkpoints.high_watermark` column — no migration).
- **In-scope** = records ≤ W (frozen). **Live growth** = records > W (deferred to next epoch).
- Because the in-scope set is immutable, the cursor converges monotonically and `ready`
  latches permanently. Ordering keys: backfill = `email.email_id` (monotonic int, `W = MAX`);
  V3 = temporal composite `(created_at, id)` because `conversation_aggregates.id` is a
  non-monotonic content digest (an `id ≤ MAX(id)` watermark is unsafe — a new random id can
  fall below the old max).

## ADR-3 — Parity execution after watermark completion

Parity becomes eligible when the checkpoint reaches READY at W. Parity's coverage comparison
already binds to `high_watermark` (`:76`); the design additionally **scopes `unexplained`
(failures + outbox) to records ≤ W**. Parity then compares two immutable ≤W sets, is
reproducible (no TOCTOU with ingest), and its verdict is a stable per-epoch statement.
Parity does not enable projection reads or imply FULL_PRODUCTION_PASS.

## ADR-4 — Interaction with future Gmail growth

Continuous ingest is expected and safe. Records > W are never dropped: on `Completed(W_n)`,
the runtime may open epoch n+1 with `W_{n+1} = current MAX`, covering the delta `(W_n, W_{n+1}]`
as a new generation with a new frozen watermark (append-only). Completion is thus a monotone
sequence of per-epoch verdicts; the newest completed epoch is the authoritative "complete as
of W_n" fact. This directly removes the global-quiescence dependency.

## ADR-5 — Rollback strategy

The change is confined to readiness/parity predicates and epoch-open watermark capture in
`unified-conversation-backfill-service.js` (and the parity-scope query). **No schema
migration** is required (the `high_watermark` column pre-exists), so rollback is code-only:
revert the service file to the prior git tag and redeploy. Because the change only *narrows*
per-epoch scope and adds latching, a rollback returns to the prior (non-terminating but
data-safe) behavior with zero data impact. Any later hardening (e.g. an explicit monotonic
`seq` column on `conversation_aggregates`) must be an additive, nullable migration so its
rollback leaves the column unused.

## Decision

Adopt high-watermark completion. Implementation is the next mission
(`UCS_HIGH_WATERMARK_IMPLEMENTATION`); this ADR changes no production state.

## Consequences

- Checkpoint READY and parity become reachable under continuous ingest.
- Completion verdicts are per-epoch, immutable, and auditable.
- No projection-read enablement, no manual checkpoint/lease manipulation, no data migration.
- FULL_PRODUCTION_PASS remains gated on a passed parity at a completed watermark epoch —
  now attainable, still not auto-granted.
