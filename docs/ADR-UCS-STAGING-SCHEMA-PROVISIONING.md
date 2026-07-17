# ADR: UCS Staging Schema Provisioning

Status: Accepted — executed on `cloud-mail-staging` only. Date: 2026-07-17.
Related: `UCS_STAGING_SCHEMA_PROVISIONING_REPORT.md`, `UCS_STAGING_MIGRATION_DEPENDENCY_GRAPH.md`,
`UCS_STAGING_SCHEMA_MANIFEST.md`, `UCS_STAGING_SCHEMA_ROLLBACK_PLAN.md`,
`UCS_STAGING_SCHEMA_POST_APPLY_VERIFICATION.md`, `UCS_STAGING_BENCHMARK_READINESS_REPORT.md`.

- **ADR-1 (blocker evidence):** staging D1 had 0 `conversation_*` tables ⇒ `processIngestOutbox`, synthetic
  outbox fixtures, and lease/fencing tests were impossible. Confirmed read-only.
- **ADR-2 (dependency closure):** determined from the migration ledger, not file numbers — staging was at
  0022; the authoritative closure is the full pending production sequence 0023–0056 (the UCS runtime references
  workspace_*, evidence, facet, commitment, canonical, checkpoint and projection objects created across
  0028/0041/0042/0044/0046 and 0047–0056).
- **ADR-3 (migration 0002):** already applied on staging (present in ledger; 0002-era tables exist). Schema
  prerequisite **satisfied**; the historical "0002 blocker" was a fresh-local-replay fixture issue, N/A to staging.
- **ADR-4 (strategy):** FULL forward replay of 0023–0056 via `wrangler d1 migrations apply --env staging`,
  over hand-picked minimal closure — authoritative, self-consistent, complete; harmless extra tables in isolated staging.
- **ADR-5 (staging-only):** all SQL executed via `--env staging` → binding `db` → `cloud-mail-staging`
  (`acf160ae…`). Production `cloud-mail` (`4c05…`) accessed read-only only.
- **ADR-6 (backup/rollback):** full `d1 export` blocked by fts5 virtual table; equivalent = pre-apply schema
  snapshot (108 objects, sha256 `18d61e71…`) + empty-data baseline; rollback = drop newly-created objects.
- **ADR-7 (destructive SQL):** none — no DROP/DELETE/rebuild in 0023–0056; only CREATE + ADD COLUMN + two
  backfill UPDATEs on new empty tables (no-ops). Additive; existing data untouched.
- **ADR-8 (fingerprint):** pre 108 objects / 50 tables; post 180 tables / 28 `conversation_*` / 278 indexes /
  82 triggers. Manifest in `UCS_STAGING_SCHEMA_MANIFEST.md`.
- **ADR-9 (readiness contract):** readiness requires present tables **and** runtime-contract columns/indexes/
  constraints **and** a passing eligibility+lease smoke — not mere table existence. All met. Schema readiness
  ≠ harness readiness.
- **ADR-10 (runtime off):** no cron, no `UCS_ACTIVATION_ENABLED`/`UCS_HWM_COMPLETION_ENABLED` in staging vars,
  projection reads off, staging Worker not redeployed. Benchmark tables are inert.
- **ADR-11 (smoke isolation):** smoke used a synthetic namespace (tenant 990001) and was fully cleaned
  (residual 0). No real data.
- **ADR-12 (scope):** no harness built, no candidate sweep run, no production acceleration evidence produced.
