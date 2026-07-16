-- WF-4 / WP-A: durable, idempotent outbound send.
-- outbound_messages is the source of truth for send lifecycle + idempotency.
-- Idempotent DDL (IF NOT EXISTS), no rename/drop — passes the migration gate.

CREATE TABLE IF NOT EXISTS outbound_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  idempotency_key TEXT NOT NULL,
  email_id INTEGER,                 -- linked email row once persisted
  status TEXT NOT NULL DEFAULT 'queued'
        CHECK(status IN ('queued','sending','sent','retry','dead','cancelled')),
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  external_message_id TEXT,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One outbound record per (user, idempotency key): the dedupe backbone.
CREATE UNIQUE INDEX IF NOT EXISTS outbound_idempotency_idx
  ON outbound_messages(user_id, idempotency_key);

-- Retry drain scans due, non-terminal rows.
CREATE INDEX IF NOT EXISTS outbound_due_idx
  ON outbound_messages(status, next_attempt_at);
