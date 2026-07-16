CREATE TABLE IF NOT EXISTS secure_auth_handoffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reference_hash TEXT NOT NULL UNIQUE,
  continuation_hash TEXT UNIQUE,
  target_email TEXT NOT NULL COLLATE NOCASE,
  domain TEXT NOT NULL,
  provider TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK(purpose = 'mailbox_provisioning'),
  nonce TEXT NOT NULL,
  device_reference_hash TEXT NOT NULL,
  user_id INTEGER,
  session_reference_hash TEXT,
  state TEXT NOT NULL CHECK(state IN ('CHALLENGE','CONTINUATION','CONSUMED','EXPIRED')),
  expires_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  consumed_at TEXT
);

CREATE INDEX IF NOT EXISTS secure_auth_handoffs_state_expiry_idx
  ON secure_auth_handoffs(state, expires_at);
CREATE INDEX IF NOT EXISTS secure_auth_handoffs_user_target_idx
  ON secure_auth_handoffs(user_id, target_email);
