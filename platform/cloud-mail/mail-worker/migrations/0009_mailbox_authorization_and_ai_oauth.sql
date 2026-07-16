CREATE TABLE IF NOT EXISTS mailbox_authorizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  grantee_user_id INTEGER NOT NULL,
  owner_user_id INTEGER NOT NULL,
  owner_account_id INTEGER NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  provider TEXT NOT NULL DEFAULT 'cloudflare_native',
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
  authorization_method TEXT NOT NULL DEFAULT 'owner_password',
  last_authorized_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revoked_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mailbox_authorizations_active_grantee_email
ON mailbox_authorizations (grantee_user_id, provider, email COLLATE NOCASE)
WHERE status = 'active' AND revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_mailbox_authorizations_owner
ON mailbox_authorizations (owner_user_id, owner_account_id, status);

CREATE TABLE IF NOT EXISTS ai_provider_tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  provider_account_email TEXT,
  provider_account_id TEXT,
  access_token_ciphertext TEXT,
  refresh_token_ciphertext TEXT,
  scope TEXT NOT NULL DEFAULT '',
  token_type TEXT,
  expires_at INTEGER,
  status TEXT NOT NULL DEFAULT 'connected' CHECK(status IN ('connected','disconnected','error')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  disconnected_at TEXT,
  UNIQUE(user_id, provider)
);

CREATE INDEX IF NOT EXISTS idx_ai_provider_tokens_user_provider_status
ON ai_provider_tokens (user_id, provider, status);
