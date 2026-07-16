CREATE TABLE IF NOT EXISTS google_oauth_test_user_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  gmail TEXT NOT NULL COLLATE NOCASE,
  normalized_gmail TEXT NOT NULL COLLATE NOCASE,
  user_id INTEGER,
  user_email TEXT COLLATE NOCASE,
  device TEXT,
  user_agent TEXT,
  oauth_error TEXT,
  oauth_error_description TEXT,
  status TEXT NOT NULL DEFAULT 'pending_google_test_user'
    CHECK(status IN (
      'pending_google_test_user',
      'approved_waiting_google_sync',
      'google_synced',
      'oauth_success',
      'oauth_failed',
      'rejected'
    )),
  requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  approved_at TEXT,
  approved_by TEXT,
  first_sync_at TEXT,
  last_google_export TEXT,
  last_google_sync_operator TEXT,
  google_sync_batch_id TEXT,
  google_sync_notes TEXT,
  oauth_success_time TEXT,
  first_mailbox_created TEXT,
  first_sync_completed TEXT,
  last_active TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  notes TEXT,
  request_count INTEGER NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS google_oauth_test_user_requests_gmail_idx
  ON google_oauth_test_user_requests(normalized_gmail);

CREATE INDEX IF NOT EXISTS google_oauth_test_user_requests_status_idx
  ON google_oauth_test_user_requests(status);

CREATE INDEX IF NOT EXISTS google_oauth_test_user_requests_requested_at_idx
  ON google_oauth_test_user_requests(requested_at);
