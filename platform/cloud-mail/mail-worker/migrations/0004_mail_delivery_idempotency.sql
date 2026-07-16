ALTER TABLE mail_delivery_dedupe RENAME TO mail_delivery_dedupe_0003_backup;

CREATE TABLE mail_delivery_dedupe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  message_key TEXT NOT NULL,
  recipient TEXT NOT NULL COLLATE NOCASE,
  normalized_recipient TEXT NOT NULL COLLATE NOCASE,
  content_hash TEXT NOT NULL,
  forwarded INTEGER NOT NULL DEFAULT 0,
  stored INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_key, normalized_recipient, content_hash)
);

INSERT INTO mail_delivery_dedupe
  (id, message_id, message_key, recipient, normalized_recipient, content_hash,
   forwarded, stored, created_at, updated_at)
SELECT
  id,
  message_id,
  CASE
    WHEN TRIM(COALESCE(message_id, '')) <> '' THEN LOWER(TRIM(message_id))
    ELSE 'content:' || content_hash
  END,
  recipient,
  normalized_recipient,
  content_hash,
  forwarded,
  stored,
  created_at,
  created_at
FROM mail_delivery_dedupe_0003_backup;

DROP TABLE mail_delivery_dedupe_0003_backup;

CREATE INDEX mail_delivery_dedupe_message_idx
  ON mail_delivery_dedupe(message_key, normalized_recipient, content_hash);
