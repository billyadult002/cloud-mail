PRAGMA foreign_keys=off;

ALTER TABLE email_identities RENAME TO email_identities_0002_backup;

CREATE TABLE email_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  normalized_email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  domain TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('cloudmail','cloudflare_routing','manual_admin','imported','system_sync')),
  routing_rule_id TEXT,
  routing_enabled INTEGER NOT NULL DEFAULT 0,
  forwarding_preserved INTEGER NOT NULL DEFAULT 0,
  destination_type TEXT NOT NULL DEFAULT 'worker',
  user_id INTEGER,
  status TEXT NOT NULL CHECK(status IN ('active','routing_only','disabled_routing','catch_all_eligible','pending','stale','not_found','verification_required')),
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO email_identities
  (id, email, normalized_email, domain, source, routing_rule_id, routing_enabled, forwarding_preserved,
   destination_type, user_id, status, last_synced_at, created_at, updated_at)
SELECT
  id,
  email,
  normalized_email,
  domain,
  source,
  routing_rule_id,
  routing_enabled,
  0,
  COALESCE(destination_type, 'worker'),
  user_id,
  CASE status
    WHEN 'disabled' THEN 'disabled_routing'
    ELSE status
  END,
  last_synced_at,
  created_at,
  updated_at
FROM email_identities_0002_backup
WHERE status IN ('active','pending','routing_only','verification_required','stale','disabled');

DROP TABLE email_identities_0002_backup;

CREATE INDEX IF NOT EXISTS email_identities_domain_idx ON email_identities(domain);
CREATE INDEX IF NOT EXISTS email_identities_user_idx ON email_identities(user_id);
CREATE INDEX IF NOT EXISTS email_identities_status_idx ON email_identities(status);
CREATE INDEX IF NOT EXISTS email_identities_routing_rule_idx ON email_identities(routing_rule_id);

-- SQLite rewrites child foreign keys when a referenced table is renamed.
-- Recreate pending_users so fresh databases do not retain a reference to the
-- temporary email_identities_0002_backup table.
ALTER TABLE pending_users RENAME TO pending_users_0002_backup;

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
FROM pending_users_0002_backup;

DROP TABLE pending_users_0002_backup;

CREATE INDEX pending_users_status_idx ON pending_users(status);
CREATE INDEX pending_users_expiry_idx ON pending_users(expires_at);

CREATE TABLE IF NOT EXISTS email_forwarding_destinations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_email TEXT NOT NULL COLLATE NOCASE,
  normalized_source_email TEXT NOT NULL COLLATE NOCASE,
  domain TEXT NOT NULL,
  destination_email TEXT NOT NULL COLLATE NOCASE,
  destination_verified INTEGER NOT NULL DEFAULT 1,
  forwarding_enabled INTEGER NOT NULL DEFAULT 1,
  preserve_original_forwarding INTEGER NOT NULL DEFAULT 1,
  source_rule_id TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_forwarded_at TEXT,
  last_error TEXT,
  UNIQUE(normalized_source_email, destination_email)
);

CREATE INDEX IF NOT EXISTS email_forwarding_source_idx
  ON email_forwarding_destinations(normalized_source_email, forwarding_enabled);

CREATE TABLE IF NOT EXISTS mail_delivery_dedupe (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  recipient TEXT NOT NULL COLLATE NOCASE,
  normalized_recipient TEXT NOT NULL COLLATE NOCASE,
  content_hash TEXT NOT NULL,
  forwarded INTEGER NOT NULL DEFAULT 0,
  stored INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(normalized_recipient, content_hash)
);

CREATE INDEX IF NOT EXISTS mail_delivery_dedupe_message_idx
  ON mail_delivery_dedupe(message_id, normalized_recipient);

ALTER TABLE identity_reconciliation_audit RENAME TO identity_reconciliation_audit_0002_backup;

CREATE TABLE identity_reconciliation_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK(event_type IN (
    'email_discovery','routing_match','pending_user_created','user_activated','routing_sync',
    'routing_disabled','routing_stale','routing_write_back','forwarding_preserved',
    'catch_all_eligible','routing_rule_migrated'
  )),
  normalized_email_hash TEXT NOT NULL,
  identity_id INTEGER,
  user_id INTEGER,
  outcome TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO identity_reconciliation_audit
  (id, event_type, normalized_email_hash, identity_id, user_id, outcome, metadata_json, created_at)
SELECT id, event_type, normalized_email_hash, identity_id, user_id, outcome, metadata_json, created_at
FROM identity_reconciliation_audit_0002_backup;

DROP TABLE identity_reconciliation_audit_0002_backup;

PRAGMA foreign_keys=on;
