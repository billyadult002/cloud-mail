-- 0021_gmail_backfill_cursor.sql
-- RC-5: Gmail-API (OAuth) path backfill cursor.
-- The IMAP path backfills via the gmail_uid_cache low-water (MIN(uid)) and needs no
-- schema. The Gmail-API path has no ordered UID, so it walks history via the list API
-- pageToken; persist that cursor here. Additive only; inert until the RC-5 API-backfill
-- code reads it (behavior is unchanged until then).
-- NOTE: SQLite/D1 ADD COLUMN has NO "IF NOT EXISTS" — run exactly once via the migration
-- ledger. Must be applied before the RC-5 API-backfill code is deployed.
ALTER TABLE account ADD COLUMN backfill_cursor TEXT;
ALTER TABLE account ADD COLUMN backfill_done   INTEGER NOT NULL DEFAULT 0;
