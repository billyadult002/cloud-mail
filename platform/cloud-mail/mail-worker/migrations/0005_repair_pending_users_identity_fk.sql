PRAGMA foreign_keys=off;

ALTER TABLE pending_users RENAME TO pending_users_broken_fk_backup;

CREATE TABLE pending_users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  domain TEXT NOT NULL,
  identity_id INTEGER NOT NULL REFERENCES email_identities(id),
  activation_token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','activated','expired','revoked')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  activated_at TEXT
);

INSERT INTO pending_users
  (id, email, domain, identity_id, activation_token_hash, expires_at, status, created_at, activated_at)
SELECT
  id, email, domain, identity_id, activation_token_hash, expires_at, status, created_at, activated_at
FROM pending_users_broken_fk_backup;

DROP TABLE pending_users_broken_fk_backup;

CREATE INDEX pending_users_status_idx ON pending_users(status);
CREATE INDEX pending_users_expiry_idx ON pending_users(expires_at);

PRAGMA foreign_keys=on;
