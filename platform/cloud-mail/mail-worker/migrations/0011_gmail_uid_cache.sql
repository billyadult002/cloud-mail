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
