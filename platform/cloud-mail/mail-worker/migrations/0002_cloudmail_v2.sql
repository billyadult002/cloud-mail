CREATE TABLE IF NOT EXISTS email_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  normalized_email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  domain TEXT NOT NULL,
  source TEXT NOT NULL CHECK(source IN ('cloudmail','cloudflare_routing','manual_admin','imported','system_sync')),
  routing_rule_id TEXT,
  routing_enabled INTEGER NOT NULL DEFAULT 0,
  destination_type TEXT NOT NULL DEFAULT 'worker',
  user_id INTEGER,
  status TEXT NOT NULL CHECK(status IN ('active','pending','disabled','routing_only','verification_required','stale')),
  last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS email_identities_domain_idx ON email_identities(domain);
CREATE INDEX IF NOT EXISTS email_identities_user_idx ON email_identities(user_id);
CREATE INDEX IF NOT EXISTS email_identities_status_idx ON email_identities(status);

CREATE TABLE IF NOT EXISTS pending_users (
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

CREATE INDEX IF NOT EXISTS pending_users_status_idx ON pending_users(status);
CREATE INDEX IF NOT EXISTS pending_users_expiry_idx ON pending_users(expires_at);

CREATE TABLE IF NOT EXISTS identity_reconciliation_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL CHECK(event_type IN ('email_discovery','routing_match','pending_user_created','user_activated','routing_sync','routing_disabled','routing_stale')),
  normalized_email_hash TEXT NOT NULL,
  identity_id INTEGER,
  user_id INTEGER,
  outcome TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mail_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  provider TEXT NOT NULL CHECK(provider IN ('cloudflare_native','gmail','outlook','imap','custom')),
  external_account_id TEXT,
  email TEXT NOT NULL COLLATE NOCASE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disconnected','not_configured','error')),
  capabilities_json TEXT NOT NULL DEFAULT '{}',
  ai_access_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, provider, email)
);

CREATE TABLE IF NOT EXISTS mail_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  external_thread_id TEXT,
  subject TEXT NOT NULL DEFAULT '',
  latest_message_at TEXT,
  message_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS mails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  thread_id INTEGER REFERENCES mail_threads(id),
  legacy_email_id INTEGER,
  external_message_id TEXT,
  direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound','draft')),
  sender_email TEXT NOT NULL DEFAULT '',
  sender_name TEXT,
  subject TEXT NOT NULL DEFAULT '',
  text_body TEXT NOT NULL DEFAULT '',
  html_body TEXT NOT NULL DEFAULT '',
  received_at TEXT,
  sent_at TEXT,
  unread INTEGER NOT NULL DEFAULT 1,
  phishing_score INTEGER NOT NULL DEFAULT 0,
  tracking_blocked INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS mails_user_received_idx ON mails(user_id, received_at);
CREATE INDEX IF NOT EXISTS mails_thread_idx ON mails(thread_id);

CREATE TABLE IF NOT EXISTS mail_recipients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mail_id INTEGER NOT NULL REFERENCES mails(id) ON DELETE CASCADE,
  recipient_type TEXT NOT NULL CHECK(recipient_type IN ('to','cc','bcc')),
  email TEXT NOT NULL COLLATE NOCASE,
  name TEXT
);

CREATE TABLE IF NOT EXISTS mail_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mail_id INTEGER NOT NULL REFERENCES mails(id) ON DELETE CASCADE,
  r2_key TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  byte_size INTEGER NOT NULL DEFAULT 0,
  content_id TEXT,
  inline INTEGER NOT NULL DEFAULT 0,
  sha256 TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  name TEXT,
  interaction_count INTEGER NOT NULL DEFAULT 1,
  last_interaction_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  blocked INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, email)
);

CREATE TABLE IF NOT EXISTS folders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  system_key TEXT,
  UNIQUE(account_id, name)
);

CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  color TEXT,
  UNIQUE(user_id, name)
);

CREATE TABLE IF NOT EXISTS mail_labels (
  mail_id INTEGER NOT NULL REFERENCES mails(id) ON DELETE CASCADE,
  label_id INTEGER NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY(mail_id, label_id)
);

CREATE TABLE IF NOT EXISTS send_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  payload_json TEXT NOT NULL,
  scheduled_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','sending','sent','failed','cancelled')),
  failure_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS send_queue_due_idx ON send_queue(status, scheduled_at);

CREATE TABLE IF NOT EXISTS read_receipts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mail_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 0,
  opened_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS unsubscribe_candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mail_id INTEGER NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('mailto','https')),
  target_encrypted TEXT NOT NULL,
  confirmed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS secure_send_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  r2_key TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT,
  access_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  actor_role TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  outcome TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS audit_logs_user_created_idx ON audit_logs(user_id, created_at);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs(action);

CREATE TABLE IF NOT EXISTS ai_outputs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  mail_id INTEGER,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  output_encrypted TEXT,
  saved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS ai_consents (
  user_id INTEGER PRIMARY KEY,
  ai_enabled INTEGER NOT NULL DEFAULT 1,
  apple_local_enabled INTEGER NOT NULL DEFAULT 1,
  cloud_ai_enabled INTEGER NOT NULL DEFAULT 0,
  single_mail_read INTEGER NOT NULL DEFAULT 1,
  thread_read INTEGER NOT NULL DEFAULT 0,
  attachment_read INTEGER NOT NULL DEFAULT 0,
  save_outputs INTEGER NOT NULL DEFAULT 0,
  search_index INTEGER NOT NULL DEFAULT 0,
  auto_classify INTEGER NOT NULL DEFAULT 0,
  cleanup_suggestions INTEGER NOT NULL DEFAULT 0,
  auto_send INTEGER NOT NULL DEFAULT 0,
  auto_delete INTEGER NOT NULL DEFAULT 0,
  auto_archive INTEGER NOT NULL DEFAULT 0,
  auto_unsubscribe INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS snoozed_mails (
  mail_id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL,
  wake_at INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS blocked_senders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  sender TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, sender)
);

INSERT INTO email_identities
  (email, normalized_email, domain, source, routing_enabled, user_id, status, last_synced_at)
SELECT
  lower(trim(account.email)),
  lower(trim(account.email)),
  substr(lower(trim(account.email)), instr(account.email, '@') + 1),
  'cloudmail',
  1,
  account.user_id,
  'active',
  CURRENT_TIMESTAMP
FROM account
JOIN user ON user.user_id = account.user_id
WHERE account.is_del = 0 AND user.is_del = 0 AND instr(account.email, '@') > 1
ON CONFLICT(normalized_email) DO UPDATE SET
  user_id = excluded.user_id,
  status = 'active',
  routing_enabled = 1,
  updated_at = CURRENT_TIMESTAMP;

INSERT INTO mail_accounts
  (user_id, provider, email, display_name, status, capabilities_json, ai_access_enabled)
SELECT
  account.user_id,
  'cloudflare_native',
  lower(trim(account.email)),
  COALESCE(NULLIF(account.name, ''), lower(trim(account.email))),
  'active',
  '{"read":true,"send":true,"attachments":true,"threads":true,"labels":true}',
  1
FROM account
JOIN user ON user.user_id = account.user_id
WHERE account.is_del = 0 AND user.is_del = 0
ON CONFLICT(user_id, provider, email) DO UPDATE SET
  status = 'active',
  updated_at = CURRENT_TIMESTAMP;
