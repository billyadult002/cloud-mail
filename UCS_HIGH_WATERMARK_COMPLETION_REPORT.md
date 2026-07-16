# UCS High-Watermark Completion & Parity Enablement — Design Report

Mission: UCS HIGH-WATERMARK COMPLETION AND PARITY ENABLEMENT
Date: 2026-07-16
Priority: P0 — **design only**. No production state modified, no deploy, no code change.
Authority baseline: source at tag `v2026.07-f3-logout` (prod Worker `d05ffd3e-…`).

## Non-interference attestation

Source inspection + architecture design only. No checkpoint/cursor/lease/outbox edit,
no parity run, no rematerialization, no projection-read activation, no deploy. Projection
reads remain 0%. Concurrent-monitor files (`UCS_W2_COMPLETION_BLOCKER_*`, `task.md`) untouched.

## Problem restatement (from RCA)

Completion is blocked by a **completion-definition defect**, not a runtime failure. The
current model equates completion with *global quiescence* (no remaining work), which a
continuously-growing production dataset can never reach.

## Evidence (E1–E6) — grounded in source

**E1 — current readiness** (`src/service/unified-conversation-backfill-service.js:66`)
`const ready = rows.length < remaining;` — recomputed every run against LIVE data; a
`ready` checkpoint is re-claimable (`claimCheckpoint`, line 17, `state IN ('paused','failed','ready')`),
so new mail flips it ready→paused→running. Readiness **un-latches**.

**E2 — current parity gate** (`:102`) `if (run.ready && membership.ready) run.parity = parityWorkspace(...)`.
`parityWorkspace` (`:75`) requires backfill `state='ready'`. Its coverage counts are already
watermark-scoped (`email_id <= high_watermark`, `:76`), **but** `failures` (`resolved_at IS NULL`)
and `outbox` (`state!='processed'`) are **not** watermark-scoped, so `unexplained = failures + outbox`
(`:76`) is inflated by live growth even when the ≤W backfill is complete.

**E3 — current checkpoint state machine** — `conversation_materialization_checkpoints`
(migration `0046`) already has columns `cursor_json`, **`high_watermark TEXT`**, `state
CHECK IN ('running','ready','paused','failed')`, `lease_*`, `processed_count`. Backfill
captures `high_watermark = MAX(email_id)` only at the moment it first goes ready (`:66`);
V3 (`rematerializeWorkspaceV3`, `:101`) captures **no** watermark and uses `ready = rows.length < limit`
over the growing `conversation_aggregates` set.

**E4 — generation growth** — lease reclaim/advance works (RCA: gen 55→84→97); the runtime
is healthy. Generations grow because each reclaim re-runs against un-latched readiness.

**E5 — historical W2 progression** — target/current/missing `2049/377/1672` (01:27) →
`2069/618/1451` (04:27) → `2104/815/1289` (13:31): coverage converges slowly while the
target keeps growing; "target stability" (a completion gate) is never reachable under ingest.

**E6 — projected behavior under the watermark model** — with an immutable per-epoch
watermark W, the in-scope set (records ≤ W) is fixed, so the cursor converges monotonically,
`ready` latches, parity runs against a reproducible snapshot, and epoch n completes while
mail > W accumulates for epoch n+1.

## New completion model

```
Current:  Completion  =  No Remaining Records                (unreachable under ingest)
New:      Completion(W) =  All Records ≤ HighWatermark(W) processed AND Parity(W) passed
```

- **W** = an immutable snapshot boundary captured once at epoch open.
- **Backfill scope** = records ≤ W. **Live growth** = records > W → next epoch.
- Completion is a **per-epoch verdict**: "W2 complete as of W_n" — a stable, monotone,
  auditable statement that continuous ingest cannot invalidate.

Full mechanics: `UCS_HIGH_WATERMARK_DESIGN_SPEC.md`. Parity: `UCS_PARITY_ELIGIBILITY_SPEC.md`.
State machine: `UCS_COMPLETION_STATE_MACHINE.md`. Tests: `UCS_HIGH_WATERMARK_ACCEPTANCE_MATRIX.md`.
Rollout/rollback: `UCS_HIGH_WATERMARK_ROLLOUT_PLAN.md`. Decisions: `docs/ADR-UCS-HIGH-WATERMARK-COMPLETION.md`.

## Verification mapping (V1–V8)

| ID | Requirement | How the design satisfies it |
|----|-------------|------------------------------|
| V1 | High watermark immutable | Captured once at epoch open; processing runs never write `high_watermark` (spec §Immutability). |
| V2 | Records ≤ W can converge | Scope is a fixed set; cursor traverses it monotonically → `ready` latches. |
| V3 | Records > W do not block completion | Out of scope for the epoch; invisible to `ready` and parity. |
| V4 | Parity becomes reachable | Runs against the immutable ≤W snapshot with `unexplained` scoped to ≤W. |
| V5 | Checkpoint can enter READY | Ready(W) latches because the target no longer grows. |
| V6 | Completion under continuous ingest | New mail (>W) cannot reset the epoch; epoch n completes regardless. |
| V7 | No record loss | Inclusive ≤W scope + receipts + next-epoch coverage of >W (spec §Data-loss). |
| V8 | No duplicate projection | Digest-keyed projections + `conversation_processing_receipts` INSERT OR IGNORE + supersedes; single cursor pass per epoch. |

## Acceptance mapping (A1–A10)

A1 explicit `high_watermark` boundary — spec §Watermark. A2 checkpoint stores it — column
already exists (no migration). A3 ready evaluated vs watermark — spec §Readiness. A4 parity
eligibility vs watermark — parity spec. A5 continuous ingest no longer blocks — §Epoch model.
A6 historical replay valid — receipts/idempotency unchanged, scope only narrows per epoch.
A7 no projection-read enablement — completion/parity do not enable reads. A8/A9 no manual
checkpoint/lease manipulation — epoch open is automatic within the runtime. A10 acceptance
walkthrough — `UCS_HIGH_WATERMARK_ACCEPTANCE_MATRIX.md`.

## Audit answers

1. **What is a completed snapshot?** A per-epoch verdict `Completed(W)`: every record with
   ordering-key ≤ W has a current projection and parity passed at W; records > W are out of scope.
2. **How is `high_watermark` created?** Captured once at epoch open — backfill: `MAX(email_id)`
   in workspace scope; V3: composite temporal `(created_at_snapshot, max_id_at_snapshot)` —
   stored in the existing `high_watermark` column; immutable thereafter.
3. **How does completion occur while new mail arrives?** New mail has ordering-key > W, is
   excluded from the frozen scope, and cannot reset `ready` or parity; epoch n completes, the
   delta is covered by epoch n+1.
4. **Why can parity run safely?** It compares immutable ≤W sets (reproducible, no TOCTOU) and
   scopes `unexplained` to ≤W, so live growth is invisible to it.
5. **How are records beyond the watermark handled?** Deferred to the next epoch's watermark
   (append-only, future generation) — never dropped.
6. **What prevents data loss?** Inclusive ≤W scope + processing receipts + guaranteed next-epoch
   coverage of >W; every record belongs to exactly one epoch scope.
7. **What prevents duplicate processing?** Content-digest projection keys + `conversation_processing_receipts`
   INSERT OR IGNORE + `supersedes_id`; a frozen scope means one cursor pass per epoch; lease-reclaim
   re-processing is idempotent.
8. **How can the design be rolled back?** Revert the service file to the pre-change git tag and
   redeploy; no migration (the column pre-exists); data-safe. Details in the rollout plan.

## Boundaries honored

No production checkpoint/cursor/lease/outbox edit; no projection-read activation; no parity run;
no rematerialization; no deploy. Design artifacts only.
