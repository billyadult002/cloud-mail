# High-Watermark Design Specification

Mission: UCS HIGH-WATERMARK COMPLETION AND PARITY ENABLEMENT (design only)
Date: 2026-07-16
Target file (implementation mission): `src/service/unified-conversation-backfill-service.js`
No schema migration required (`high_watermark` column exists in migration `0046`).

## 1. Watermark definition (per pipeline, per tenant/workspace)

| Pipeline | Ordering key | Watermark W | Storage encoding |
|----------|--------------|-------------|------------------|
| `ucs-backfill-v1` | `email.email_id` (monotonic INTEGER) | `W = MAX(email_id)` in workspace scope at epoch open | `high_watermark = "<email_id>"` |
| `ucs-projection-rematerialize-v3` | `conversation_aggregates.id` (TEXT digest, **non-monotonic**) | temporal composite `W = (created_at_snapshot, max_id_at_snapshot)` | `high_watermark = "<created_at>|<id>"` |

**Why V3 must be temporal, not `id ≤ MAX(id)`:** `conversation_aggregates.id` is a content
digest. A row created *after* the snapshot can have an `id` lexicographically **below** the
old `MAX(id)`, so an `id ≤ MAX` predicate would silently pull future rows into scope,
violating immutability. `created_at` is set to `CURRENT_TIMESTAMP` at insert and is monotone,
so `created_at ≤ W_ts` cleanly partitions past from future.

**Composite tie-breaker (same-second inserts):** because `created_at` is second-precision,
scope is defined by tuple order:
`( created_at < W_ts ) OR ( created_at = W_ts AND id ≤ W_id )`
and traversal is `ORDER BY created_at, id`. `W_id = MAX(id)` among rows with
`created_at = W_ts` at snapshot instant. A row inserted later in the same second with an
`id > W_id` is excluded; one with `id ≤ W_id` cannot exist post-snapshot because those ids
were already the max seen. (Strict-monotonic alternative in §6.)

## 2. Epoch open (freeze W) — the only place W is written

```
on epoch open (CREATED→EPOCH_OPEN, or COMPLETED→next epoch):
  if high_watermark IS NULL (or epoch advancing):
     W := snapshot(MAX ordering-key in workspace scope)     -- one SELECT
     UPDATE checkpoint SET high_watermark = encode(W),
            cursor_json = epoch_start_cursor
      WHERE id=? AND high_watermark IS NULL   -- CAS: write-once per epoch
```
Processing runs (`runWorkspace`, `rematerializeWorkspaceV3`) MUST NOT write `high_watermark`.
(Contrast current backfill `:66`, which sets `high_watermark` opportunistically when it first
goes ready — move this to epoch open and forbid later writes.)

## 3. Scope predicate (in-scope = records ≤ W)

- Backfill base query (`:55`): append `AND e.email_id <= <W>`.
- V3 fetch (`:101`): replace `id > cursor ORDER BY id LIMIT n` with
  `WHERE (created_at,id) > (cursor_ts,cursor_id) AND (created_at,id) <= (W_ts,W_id)
   ORDER BY created_at, id LIMIT n`, cursor stored as `{created_at,id}`.

## 4. Readiness (latched) — replaces `rows.length < remaining`

```
ready(W) := (no in-scope row remains after the current cursor)
          ⇔ next_in_scope_fetch(limit=1) returns 0 rows
          ⇔ cursor has reached W
on ready: UPDATE ... SET state='ready' (high_watermark UNCHANGED)
```
Because the in-scope set is immutable, once `ready(W)` holds it holds forever for that epoch;
arrivals > W are outside the predicate and cannot reset it. (Contrast current `:66`, which
compares against a live-growing `remaining` and un-latches.)

## 5. Data-loss & duplicate-processing guarantees

- **No loss (V7):** scope is *inclusive* of all records ≤ W; records > W are guaranteed a
  future epoch (W_{n+1} = current MAX ⊇ everything > W_n). Every record belongs to exactly one
  epoch scope. Existing `conversation_pipeline_failures` retries keep transient ≤W failures in scope.
- **No duplicates (V8):** projections are digest-keyed with `supersedes_id`
  (`materialize`, `:48`); `conversation_processing_receipts` uses `INSERT OR IGNORE` (`:49`);
  a frozen scope means one cursor pass per epoch; lease-reclaim re-processing re-hits the same
  receipts/keys and is idempotent. No change needed — the watermark only *narrows* what a pass covers.

## 6. Optional hardening (future additive migration — not required now)

Add `conversation_aggregates.seq INTEGER` (autoincrement-style, nullable, backfilled) to give
V3 a strictly-monotonic ordering key; then `W_v3 = MAX(seq)` and scope `seq ≤ W`. Additive +
nullable ⇒ rollback-safe. Until then, the temporal composite (§1) is authoritative.

## 7. Change surface summary (for the implementation mission)

| # | Location | Change |
|---|----------|--------|
| 1 | epoch-open (new helper / `claimCheckpoint` caller) | freeze `high_watermark` write-once |
| 2 | `runWorkspace` `:55/:64` | add `email_id ≤ W` scope |
| 3 | `runWorkspace` `:66` | `ready` = in-scope exhausted (latched), don't rewrite W |
| 4 | `rematerializeWorkspaceV3` `:101` | freeze W + composite scope + latched ready + composite cursor |
| 5 | `parityWorkspace` `:76` | scope `failures`/`outbox` to ≤W (see parity spec) |
| 6 | `monitorScheduled` `:102` | gate unchanged; membership readiness scoped ≥ W |
| 7 | epoch advance | on `Completed(W_n)` optionally open W_{n+1} for the delta |

All within one service file + no migration ⇒ code-only, revertible (rollout plan).
