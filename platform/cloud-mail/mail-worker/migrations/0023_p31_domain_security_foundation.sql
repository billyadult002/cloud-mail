-- 0023_p31_domain_security_foundation.sql
-- P31 additive-only domain, mailbox capability, security, and lifecycle foundation.
-- Do not run as a production migration without a separate explicit migration task.

CREATE TABLE IF NOT EXISTS cloudmail_domains (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE COLLATE NOCASE,
  cloudflare_account_ref TEXT,
  cloudflare_zone_id TEXT,
  zone_status TEXT NOT NULL DEFAULT 'unknown',
  provisioning_state TEXT NOT NULL CHECK(provisioning_state IN (
    'NO_DOMAIN_SELECTED',
    'DISCOVERED',
    'SCANNING',
    'NEEDS_CONFIGURATION',
    'CONFIGURING',
    'DNS_PENDING',
    'ROUTING_PENDING',
    'SENDING_PENDING',
    'MAILBOX_PENDING',
    'SECURITY_PENDING',
    'READY',
    'PARTIAL_WITH_REAL_BLOCKER',
    'FAILED'
  )) DEFAULT 'DISCOVERED',
  linkage_state TEXT NOT NULL DEFAULT 'unlinked',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS domain_readiness_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL COLLATE NOCASE,
  mx_status TEXT NOT NULL DEFAULT 'unknown',
  spf_status TEXT NOT NULL DEFAULT 'unknown',
  dkim_status TEXT NOT NULL DEFAULT 'unknown',
  dmarc_status TEXT NOT NULL DEFAULT 'unknown',
  inbound_email_worker_status TEXT NOT NULL DEFAULT 'unknown',
  outbound_provider_status TEXT NOT NULL DEFAULT 'unknown',
  mailbox_status TEXT NOT NULL DEFAULT 'unknown',
  identity_status TEXT NOT NULL DEFAULT 'unknown',
  capability_status TEXT NOT NULL DEFAULT 'unknown',
  security_foundation_status TEXT NOT NULL DEFAULT 'ready',
  blockers_json TEXT NOT NULL DEFAULT '[]',
  desired_dns_json TEXT NOT NULL DEFAULT '[]',
  source_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_domain_readiness_domain_created
  ON domain_readiness_snapshots(domain, created_at);

CREATE TABLE IF NOT EXISTS mailboxes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL COLLATE NOCASE,
  local_part TEXT NOT NULL COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  owner_user_id INTEGER,
  routing_state TEXT NOT NULL DEFAULT 'unknown',
  receive_capability_state TEXT NOT NULL DEFAULT 'pending_domain_readiness',
  send_capability_state TEXT NOT NULL DEFAULT 'pending_outbound_provider',
  account_health_state TEXT NOT NULL DEFAULT 'unknown',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS domain_identities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL COLLATE NOCASE,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  identity_type TEXT NOT NULL DEFAULT 'mailbox',
  owner_user_id INTEGER,
  admin_linkage_state TEXT NOT NULL DEFAULT 'unlinked',
  capability_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS domain_capabilities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE COLLATE NOCASE,
  receive_state TEXT NOT NULL DEFAULT 'pending_domain_readiness',
  send_state TEXT NOT NULL DEFAULT 'pending_outbound_provider',
  attachment_state TEXT NOT NULL DEFAULT 'ready',
  ai_state TEXT NOT NULL DEFAULT 'local_only',
  provider_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS retention_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL COLLATE NOCASE,
  policy_name TEXT NOT NULL DEFAULT 'default',
  retention_days INTEGER NOT NULL DEFAULT 365,
  applies_to TEXT NOT NULL DEFAULT 'mail',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS expiration_policies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL COLLATE NOCASE,
  policy_name TEXT NOT NULL DEFAULT 'default',
  expire_after_days INTEGER NOT NULL DEFAULT 730,
  destructive_enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS legal_holds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL COLLATE NOCASE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  hold_reason TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1,
  created_by_user_id INTEGER,
  released_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_legal_holds_target_active
  ON legal_holds(target_type, target_id, active);

CREATE TABLE IF NOT EXISTS security_classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL COLLATE NOCASE,
  classification_key TEXT NOT NULL,
  label TEXT NOT NULL,
  retention_policy_id INTEGER,
  expiration_policy_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(domain, classification_key)
);

CREATE TABLE IF NOT EXISTS secure_link_metadata (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL COLLATE NOCASE,
  link_type TEXT NOT NULL DEFAULT 'secure_send',
  status TEXT NOT NULL CHECK(status IN (
    'DRAFT',
    'ACTIVE',
    'EXPIRED',
    'REVOKED',
    'LEGAL_HOLD_LOCKED',
    'DISABLED'
  )) DEFAULT 'DRAFT',
  token_hash TEXT NOT NULL UNIQUE,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  revoked_at TEXT,
  legal_hold_id INTEGER,
  view_limit INTEGER,
  attachment_download_policy TEXT NOT NULL DEFAULT 'metadata_only_until_secure_send_enabled',
  access_count INTEGER NOT NULL DEFAULT 0,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS message_security_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  domain TEXT NOT NULL COLLATE NOCASE,
  classification_key TEXT NOT NULL DEFAULT 'standard',
  retention_policy_id INTEGER,
  expiration_policy_id INTEGER,
  legal_hold_active INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  security_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(message_id, domain)
);

CREATE TABLE IF NOT EXISTS attachment_security_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  attachment_id TEXT NOT NULL,
  message_id TEXT,
  domain TEXT NOT NULL COLLATE NOCASE,
  classification_key TEXT NOT NULL DEFAULT 'standard',
  legal_hold_active INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER,
  security_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(attachment_id, domain)
);

CREATE TABLE IF NOT EXISTS domain_security_policy (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL UNIQUE COLLATE NOCASE,
  default_classification_key TEXT NOT NULL DEFAULT 'standard',
  legal_hold_precedence INTEGER NOT NULL DEFAULT 1,
  retention_precedence INTEGER NOT NULL DEFAULT 1,
  expiration_destructive_enabled INTEGER NOT NULL DEFAULT 0,
  secure_link_default_ttl_seconds INTEGER NOT NULL DEFAULT 86400,
  audit_required INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT COLLATE NOCASE,
  actor_user_id INTEGER,
  actor_role TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  outcome TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_audit_events_domain_created
  ON audit_events(domain, created_at);
