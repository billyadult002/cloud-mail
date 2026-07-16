-- WF-10 / WP-F: retire runtime DDL. gmail_uid_cache, gmail_sync_runs and
-- gmail_sync_run_accounts were being CREATEd on every sync call from
-- gmail-imap-service.js (ensureGmailUidCache / ensureGmailSyncRunTables). Moving
-- them into the migration ledger makes the schema authoritative and removes the
-- per-sync DDL round-trips. All idempotent; no rename/drop.

CREATE TABLE IF NOT EXISTS gmail_uid_cache (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  mailbox TEXT NOT NULL DEFAULT 'INBOX',
  uid_validity INTEGER NOT NULL DEFAULT 0,
  uid INTEGER NOT NULL,
  external_message_id TEXT NOT NULL DEFAULT '',
  email_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, account_id, mailbox, uid_validity, uid)
);
CREATE INDEX IF NOT EXISTS gmail_uid_cache_account_idx
  ON gmail_uid_cache(user_id, account_id, mailbox, uid_validity, uid);

CREATE TABLE IF NOT EXISTS gmail_sync_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL DEFAULT 'scheduled',
  cron TEXT,
  checked_accounts INTEGER NOT NULL DEFAULT 0,
  synced_accounts INTEGER NOT NULL DEFAULT 0,
  failed_accounts INTEGER NOT NULL DEFAULT 0,
  stale_minutes INTEGER NOT NULL DEFAULT 0,
  batch_size INTEGER NOT NULL DEFAULT 0,
  message_limit INTEGER NOT NULL DEFAULT 0,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS gmail_sync_run_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  status TEXT NOT NULL,
  synced_messages INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS gmail_sync_run_accounts_run_idx
  ON gmail_sync_run_accounts(run_id, account_id);
