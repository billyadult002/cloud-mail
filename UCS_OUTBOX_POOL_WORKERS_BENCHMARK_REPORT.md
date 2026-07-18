# UCS Outbox Pool-Workers Inline-Schema Benchmark Report

Mission: UCS OUTBOX POOL-WORKERS INLINE-SCHEMA BENCHMARK AND SAFE CANDIDATE QUALIFICATION
(Option A, user-selected). Date: 2026-07-18.
Verdict: **BENCHMARK_COMPLETE_LOGIC_QUALIFIED** — candidate decision: **SAFE_CANDIDATE=25** (bounded by
`MAX_OUTBOX_DRAIN_LIMIT`), subject to a separate production canary per ADR-4.

Prior context (not repeated): RCA `38f61de`, limit impl `3b46ecd`, staging schema provisioning `ce385b9`,
staging-benchmark execution-model blocker `6536677`. This report supersedes the blocker only for the scope
the user explicitly authorized (pool-workers inline schema), not for staging/production D1 timing.

## Authoritative command (E-required)

```
cd platform/cloud-mail/mail-worker
npx vitest run scripts/reliability-tests/ucs-outbox-pool-workers-benchmark.test.mjs --reporter=verbose
```

Full existing regression gate (V11):

```
npx vitest run scripts/reliability-tests
```

## Environment (E-required)

- Runtime: `@cloudflare/vitest-pool-workers@0.18.4` (real `workerd`), local ephemeral D1 bound as `env.db`.
- No network binding to `cloud-mail-staging` or production `cloud-mail` D1. No credentials present in process.
- Positive evidence (E10, test `E10:`): 20 consecutive `SELECT 1` round-trips against `env.db` all completed
  in <50ms with near-zero jitter — remote D1 never exhibits this; local-only confirmed.
- Base commit: `6536677` (repo HEAD at benchmark start), `65366774da1a…`.

## Fixture (E1-E4)

Inline minimal schema — **verbatim** `CREATE TABLE`/`CREATE INDEX` SQL captured via a read-only
`wrangler d1 execute db --env staging --remote` query against `cloud-mail-staging` (post `ce385b9`,
`rows_written=0`, `changed_db=false`) for the 13 tables `processIngestOutbox`→`materialize()` actually touch:
`attachments, conversation_aggregates, conversation_commitment_heads, conversation_commitments,
conversation_facet_heads, conversation_facet_results, conversation_ingest_outbox,
conversation_materialization_checkpoints, conversation_messages, conversation_mission_provenance,
conversation_pipeline_failures, conversation_projections, email, mail_canonical_state` + 4 indexes
(`idx_ucs_ingest_pending`, `idx_ucs_messages_conversation`, `idx_ucs_messages_source`,
`idx_conversation_projection_current`). No column/constraint/index was hand-invented (ADR-2).

Fixture rows use the **real** `'canonical:'` source_version branch inside `processIngestOutbox`
(`unified-conversation-backfill-service.js:80`) — an existing, non-fabricated code path that looks up a
pre-existing `conversation_messages` row and calls the real `materialize()` directly, skipping
`observeMessage`/classification. This kept the inlined schema to only the tables `materialize()` touches
while still exercising genuine claim → lease → fence → process/fail → evidence-free-materialize semantics.
No real mail, tokens, passwords, or production IDs (synthetic tenant `990101`/workspace `990102`/account
`990103`, synthetic subjects/bodies only) (E3).

## 24/24 test result

```
Test Files  1 passed (1)
     Tests  24 passed (24)
  Duration  4.81s
```

## Candidate sweep results (E5/E6, ≥3 runs each)

| Candidate | Effective limit | Runs | elapsedMs (each run) | avg elapsedMs | attempted | processed | duplicates | orphans | lease | fencing | idempotency | cleanup |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| default (unset) | 2 | 3 | [8, 8, 7] | 7.7 | 2 | 2 | 0 | 0 | released | valid | idempotent | clean |
| 2 | 2 | 3 | [7, 6, 6] | 6.3 | 2 | 2 | 0 | 0 | released | valid | idempotent | clean |
| 10 | 10 | 3 | [26, 88, 26] | 46.7 | 10 | 10 | 0 | 0 | released | valid | idempotent | clean |
| 15 | 15 | 3 | [39, 35, 46] | 40.0 | 15 | 15 | 0 | 0 | released | valid | idempotent | clean |
| 20 | 20 | 3 | [51, 49, 58] | 52.7 | 20 | 20 | 0 | 0 | released | valid | idempotent | clean |
| 25 | 25 | 3 | [67, 78, 67] | 70.7 | 25 | 25 | 0 | 0 | released | valid | idempotent | clean |

Raw JSON (18 rows) captured verbatim from test stdout, archived at
`platform/cloud-mail/mail-worker/scripts/reliability-tests/ucs-outbox-pool-workers-benchmark.test.mjs`
console output (reproducible by re-running the authoritative command above).

**V1/V2 confirmed:** default (no `UCS_OUTBOX_DRAIN_LIMIT`) resolves to effective limit 2; explicit `'2'` is
byte-identical in behavior (same attempted/processed/timing profile within noise).

**Baseline comparison:** every candidate `attempted == effective limit == processed` (batch cap always fully
exercised, since each fixture seeds `limit+5` eligible rows) and `failed=0` for the success-path fixture — no
regression from the existing default-2 behavior; larger limits process proportionally more rows per
invocation with no correctness change. The `elapsedMs` growth is monotonic with limit but is **local
pool-workers CPU/query overhead only** (run 2 of candidate 10 shows a single 88ms outlier vs. 26ms sibling
runs — consistent with local scheduling jitter, not a correctness signal) — see Environment Relevance below.

## Lease / fencing / idempotency evidence (E7-E9)

- **Lease release (V6):** after each drain call, `conversation_materialization_checkpoints` for
  `ucs-live-checkpoint:{tenant}:{workspace}` shows `state='paused'`, `lease_owner=NULL` — never left `running`.
- **Fencing (V6, E8):** an outbox row force-set to `state='processing', lease_owner='stale-owner',
  lease_until=+5min` is **not** eligible (`0` rows match the real eligibility predicate) while the lease is
  active; after expiring the lease (`lease_until=-1min`) the same row becomes eligible (`1` row) — the real
  `WHERE lease_until IS NULL OR datetime(lease_until)<=CURRENT_TIMESTAMP` predicate, unmodified.
- **Stale-owner rejection (E8, dedicated test):** claiming a row under `owner-A` then attempting the identical
  real claim UPDATE under `owner-B` returns `meta.changes=0` (rejected); `lease_owner` remains `owner-A`.
- **Idempotency (V7, E9):** re-running `processIngestOutbox` against an already-drained batch increases
  `conversation_projections` (`state='current'`) count by exactly the newly-processed count, never re-adds a
  row for an already-processed source; `duplicateCurrentProjections()==0` after every run.
- **No duplicates / no orphans (V8/V9):** for every candidate and run, `duplicates=0` and `orphans=0` —
  verified via `GROUP BY conversation_id HAVING COUNT(*)>1` (duplicates) and a `NOT EXISTS` join from
  `conversation_projections` back to a `processed` outbox row (orphans).
- **Cleanup (V10):** after each run, all 14 fixture tables are dropped/recreated and a `SELECT COUNT(*)`
  across all of them returns `0` residual rows.

## Failure and partial/empty batch semantics (CP9, V4/V5)

Dedicated test seeds 2 real failure rows (`'canonical:'` source_version pointing at an existing `email` row
with **no** matching `conversation_messages` row — the real code throws
`canonical_projection_conversation_missing`, caught by `processIngestOutbox`'s existing catch block):
- Both rows end `state='failed'`, `last_error_code='canonical_projection_conversation_missing'`,
  `lease_owner=NULL`, `lease_until` set ~5 minutes out (real backoff, not fabricated).
- Exactly 2 (not 4) `conversation_projections` rows exist — only the genuinely-succeeded rows materialized.
- Empty batch: `claimed=true, processed=0, failed=0`, zero projections created.
- Partial batch (3 eligible rows, limit 10): `processed=3, failed=0`, `pending=0` after one call.

## E7 — processed only via the real path

Every `state='processed'` transition in this benchmark occurs inside `processIngestOutbox`'s own two
`UPDATE conversation_ingest_outbox SET state='processed'...` statements (unmodified source) — no test
directly sets `state='processed'`; the harness only ever seeds `state='pending'` and reads back results.

## Full regression gate (V11)

```
npx vitest run scripts/reliability-tests
Test Files  33 passed (33)
     Tests  292 passed (292)
```

No pre-existing UCS/F1/F3/F2/F5 test regressed. 24 new tests are additive.

## SAFE_CANDIDATE decision (A5)

**SAFE_CANDIDATE = 25** (the maximum configurable value, `MAX_OUTBOX_DRAIN_LIMIT`) is the highest
pool-workers-stable candidate: all six candidates (default/2/10/15/20/25) passed every correctness,
lease/fencing, idempotency, duplicate/orphan, and cleanup check across 3 runs each with zero failures. No
candidate exhibited instability, lease leakage, or data corruption at any tested batch size.

This is a **logic/relative-performance qualification only** (ADR-3). It does **not** by itself authorize
raising production `UCS_OUTBOX_DRAIN_LIMIT` to 25 — see Production Canary Entry Criteria below.

## Environment relevance — what this benchmark CANNOT prove (ADR-3, explicit limitation statement)

This benchmark used @cloudflare/vitest-pool-workers' local ephemeral D1. It proves:
- Service logic correctness for `processIngestOutbox` at each tested limit.
- Batch-limit configuration parsing and clamping (V1/V2).
- Lease/fencing correctness under concurrent-claim conditions.
- Idempotency and no-duplicate/no-orphan guarantees.
- Relative throughput *trend* between candidates in a fixed local environment.

It does **NOT** and cannot prove:
- Cloudflare remote D1 latency (staging or production) — local pool-workers D1 has near-zero I/O latency,
  unrepresentative of a real network round-trip.
- Scheduled-delivery frequency in production (the RCA's dominant throughput limiter, ~5 invocations/hour).
- Production's real ~55-second Worker invocation time budget under the Free-plan 10ms CPU ceiling.
- A production-safe batch size — a larger local-stable limit could still exceed production's per-invocation
  CPU/time budget under real D1 latency, which this harness cannot measure.

## Production canary entry criteria (Required Output #8)

Before any production `UCS_OUTBOX_DRAIN_LIMIT` change beyond the current unset default (2):
1. This report + `docs/ADR-UCS-OUTBOX-POOL-WORKERS-BENCHMARK.md` reviewed and the logic-only scope acknowledged.
2. A separate, explicitly user-authorized production canary mission (per the original mission's
   `NEXT IF SAFE_CANDIDATE EXISTS`) that: sets a bounded candidate value (recommend starting at a value well
   below 25, e.g. 10, not the pool-workers maximum) via the existing flag-gated `UCS_OUTBOX_DRAIN_LIMIT`
   staged in `3b46ecd`, observes real production drain rate and Worker CPU/duration metrics over a bounded
   window, and defines an explicit rollback trigger (e.g. any `failed` spike, any CPU-limit exceeded error,
   any lease-conflict spike).
3. Production UCS convergence status re-checked immediately before the canary (must not conflict with
   ongoing HWM V3 convergence work).
4. No candidate above the pool-workers-qualified maximum (25) may ever be proposed for production, per ADR-4.

## Non-interference (E10, production/staging unchanged)

No staging or production D1/KV/R2/Worker was written to or redeployed by this benchmark. No
`UCS_OUTBOX_BENCHMARK_*` variable was added anywhere. No HTTP endpoint was added to the shared Worker. No
toolchain package was upgraded (`package.json`/`package-lock.json` untouched). No cron modified. Verified via
`git status` scope (only the new test file + this report + its ADR are new/modified by this work).

## Audit answers

1. Harness execution model? Pool-workers inline minimal schema (user-selected Option A), real
   `processIngestOutbox` invoked directly against ephemeral local D1.
2. Inline schema source? Verbatim `sqlite_master` SQL read from `cloud-mail-staging` post-`ce385b9`
   (read-only query, `rows_written=0`).
3. processIngestOutbox invoked? Yes, directly, unmodified source, 18 candidate runs + dedicated
   failure/lease/fencing/idempotency/empty/partial-batch tests (24 tests total).
4. Candidate 2/10/15/20/25 results? See table above — all passed with zero failures, duplicates, or orphans.
5. Duplicate/orphan/fencing failure? None observed in any of the 24 tests.
6. Highest stable candidate? 25 (the configured maximum) — logic-stable in pool-workers; NOT a production
   recommendation by itself.
7. What can't be concluded from pool-workers? Remote D1 latency, scheduled-delivery frequency, production
   55s invocation behavior, production-safe batch size (see Environment Relevance).
8. Fixtures cleaned / authority closed? Yes — schema dropped and residual-row count verified `0` after every
   run; no staging/production authority touched.
9. Production Worker/flag/reads changed? No — this benchmark made zero staging or production writes.

## Final verdict

**BENCHMARK_COMPLETE_LOGIC_QUALIFIED.** Candidate decision: **SAFE_CANDIDATE=25** (pool-workers logic
qualification only — not a production performance claim). Per NEXT IF SAFE_CANDIDATE EXISTS, the follow-on
mission is **UCS W2 OUTBOX DRAIN BOUNDED PRODUCTION CANARY AND CONVERGENCE VERIFICATION**, gated on the entry
criteria above and requiring separate explicit user authorization before any production flag change.
