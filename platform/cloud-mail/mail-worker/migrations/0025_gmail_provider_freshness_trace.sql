CREATE TABLE IF NOT EXISTS gmail_provider_freshness (
  account_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  history_cursor TEXT,
  provider_connected INTEGER NOT NULL DEFAULT 0,
  oauth_valid INTEGER NOT NULL DEFAULT 0,
  token_refresh_valid INTEGER NOT NULL DEFAULT 0,
  last_provider_check_at TEXT,
  last_delta_sync_at TEXT,
  last_worker_ingest_at TEXT,
  last_provider_message_id TEXT,
  last_provider_message_time TEXT,
  last_ledger_message_time TEXT,
  last_visible_message_time TEXT,
  sync_health TEXT NOT NULL DEFAULT 'unknown',
  provider_status TEXT NOT NULL DEFAULT 'unknown',
  failure_reason TEXT,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_gmail_provider_freshness_user ON gmail_provider_freshness(user_id, account_id);
