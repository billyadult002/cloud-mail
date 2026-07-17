# UCS Staging Schema Preflight Report

Mission: UCS ISOLATED STAGING SCHEMA PROVISIONING. Date: 2026-07-17.

## Preflight checks (CP12/E13)

1. Target resolution (V7/V14): `wrangler d1 migrations list db --env staging --remote` resolves to
   `cloud-mail-staging` (`acf160ae…`). Production `cloud-mail` (`4c05…`) is never a target.
2. Pending set (V1): 0023–0056 (34), matching the ledger gap (staging at 0022).
3. Destructive-SQL scan (V5/ADR-7): no DROP/DELETE/table-rebuild; only CREATE + ADD COLUMN + 2 backfill
   UPDATEs on new empty tables.
4. Production-data dependence (E7/E8/E9/V3): none — migrations create schema and (for the 2 UPDATEs) backfill
   tables they themselves create; no reference to production rows, no data copy.
5. Credentials/secrets (E10/V4): none read; migrations are DDL/DML only.
6. Backup (E11): full `d1 export` blocked by fts5 (`email_fts`); equivalent schema snapshot + empty-data
   baseline captured (rollback = drop new objects).
7. Data baseline (additive proof): account/user/email = 0 rows pre-apply.

Preflight verdict: safe to apply (additive, staging-only, empty existing data, rollback defined).
