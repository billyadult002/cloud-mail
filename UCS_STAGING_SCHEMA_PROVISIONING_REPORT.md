# UCS Staging Schema Provisioning Report

Mission: UCS ISOLATED STAGING SCHEMA PROVISIONING AND BENCHMARK READINESS VERIFICATION
Date: 2026-07-17
Verdict: **STAGING_UCS_SCHEMA_PROVISIONED_BENCHMARK_READY**
Scope: staging-only schema provisioning. No harness, no candidate sweep, no production change.

## Not repeated (CP1)

RCA `38f61de`, limit impl `3b46ecd` (`UCS_OUTBOX_DRAIN_LIMIT`), blocker evidence `901c0a1` — confirmed, not redone.

## Starting state (E1/E2)

- Staging D1 `cloud-mail-staging` (`acf160ae-4efd-48d0-9d1b-7500f4cd0f41`): 50 tables, **0 `conversation_*` tables**,
  108 schema objects (pre-apply snapshot sha256 `18d61e71…`). Existing data empty: account/user/email = 0 rows.
- `d1_migrations` ledger: **0002–0022 applied (21 migrations)**. Gap to provision: **0023–0056 (34 migrations)**.

## Migration-0002 adjudication (A3 / ADR-3)

Migration 0002 is **already applied on staging** (present in the ledger; the 0002-era `account`/`user`/`email`
tables exist). The historically-noted "0002 blocker" was a *fresh local-replay* fixture issue (a from-scratch
DB missing the `account` table before a later migration) — it does **not** apply to staging, which already
satisfies that prerequisite. 0002 is a schema prerequisite, **satisfied**; no synthetic substitution needed.

## Strategy (A4 / ADR-4): FULL forward replay of the pending production sequence

Chosen: apply the exact pending production migrations **0023→0056** via `wrangler d1 migrations apply db
--env staging --remote`, rather than a hand-picked minimal closure. Rationale: the production sequence is
authoritative and self-consistent (it is what production ran), which guarantees a complete dependency closure
without hand-analysis errors; the extra non-UCS tables it creates are harmless in isolated staging. A minimal
closure would risk missing a transitive dependency (many UCS tables reference workspace_*, evidence, facet,
commitment, and canonical objects created across 0028/0041/0042/0044/0046). See the dependency graph doc.

## Safety analysis (A6 / ADR-7 / V5)

Static scan of 0023–0056: **no `DROP TABLE`, no `DROP COLUMN`, no `DELETE`, no table-rebuild**. Only
`CREATE TABLE/INDEX/TRIGGER`, `ALTER … ADD COLUMN`, and two backfill `UPDATE`s (0043 `communication_commitments`,
0045 `workspace_account_binding_subjects`) that target tables created within the same set (empty ⇒ no-ops).
The migration is **purely additive**; existing staging tables/data are not modified.

## Backup (A5 / E11 / E12 / ADR-6)

`wrangler d1 export` is **blocked by a D1 limitation** ("cannot export databases with Virtual Tables (fts5)")
because staging has `email_fts`. Equivalent applied: pre-apply **schema snapshot** (108 objects, sha256
`18d61e71…`, saved to scratchpad) + **empty-data baseline** (account/user/email = 0). Combined with the
additive-only guarantee, this yields a deterministic rollback (drop the newly-created objects; existing data
untouched). See the rollback plan.

## Execution (E14/E15/E16 / CP13/CP14)

`wrangler d1 migrations apply db --env staging --remote` (explicitly `--env staging` → binding `db` →
`cloud-mail-staging`/`acf160ae…`, **not** production `4c05…`). All **34 migrations 0023–0056 succeeded (✅)**,
~10 s total (12:43:51→12:44:01 UTC). No failures.

## Post-apply (E17/E18/E19)

- 180 tables (**+130**), **28 `conversation_*` tables**, 278 indexes, 82 triggers.
- Existing data unchanged: account/user/email still 0 rows (additive confirmed).
- 15/15 runtime-critical UCS tables present (outbox, checkpoints, aggregates, messages, canonical_state,
  projections, receipts, pipeline_failures, cutover_state, evidence, facet_heads/results, commitment_heads,
  workspace_account_bindings, workspace_members).
- Runtime-contract columns verified: `conversation_ingest_outbox`(state, attempt_count, lease_owner,
  lease_until, source_message_id, source_version, event_type CHECK('observed','updated')),
  `conversation_materialization_checkpoints`(cursor_json, high_watermark, lease_owner, lease_generation,
  lease_until, state). Outbox eligibility index `idx_ucs_ingest_pending` present.

## Synthetic schema smoke (E21/E22 / A10/A11)

Synthetic namespace tenant=990001/workspace=990002/account=990003: inserted one `pending` outbox row →
consumer eligibility read = **1** → lease claim (`state=processing`, `lease_until=+5min`) via the fenced
predicate = success → post-claim eligibility = **0** (active lease fences it) → delete → residual = **0**.
Eligibility + lease/fencing verified at the schema level; `processed` was **not** faked.

## Runtime-off & non-interference (E23–E26 / A12–A15)

Staging runtime stays OFF: `[env.staging.triggers] crons=[]`, no `UCS_ACTIVATION_ENABLED`/`UCS_HWM_COMPLETION_ENABLED`
in staging vars, staging Worker **not** redeployed, projection reads off. Production read-only confirmed
unchanged: Worker `525681a1` (100%), `UCS_HWM_COMPLETION_ENABLED="true"`, W2 `projection_read_enabled=0`
(`rows_written=0`). No production D1/KV/R2/Worker change.

## Benchmark readiness (A17 / ADR-9)

Schema contract is **met** (tables/columns/indexes/constraints present + smoke passes) ⇒
STAGING_UCS_SCHEMA_PROVISIONED_BENCHMARK_READY. **Caveats (V29/V30):** schema readiness ≠ harness readiness —
the benchmark harness, a materialize-succeeding fixture, and the candidate sweep are the *next* mission; and
staging D1 timing is not production timing, so candidate qualification must be interpreted accordingly.
