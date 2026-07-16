-- 0024_p32c_enterprise_delivery_security_governance.sql
-- P32C additive-only enterprise delivery security and governance foundation.
-- Do not run as a production migration without a separate explicit migration task.

CREATE TABLE IF NOT EXISTS organizations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  tenant_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  sso_connection_placeholder_json TEXT NOT NULL DEFAULT '{}',
  scim_provisioning_placeholder_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS domain_ownership (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  tenant_id INTEGER NOT NULL,
  domain TEXT NOT NULL UNIQUE COLLATE NOCASE,
  ownership_state TEXT NOT NULL DEFAULT 'pending',
  policy_scope_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS org_memberships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  tenant_id INTEGER,
  user_id INTEGER,
  role_key TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS roles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_key TEXT NOT NULL UNIQUE CHECK(role_key IN ('OWNER','ADMIN','COMPLIANCE_OFFICER','AUDITOR','USER')),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  permission_key TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS role_permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role_key TEXT NOT NULL,
  permission_key TEXT NOT NULL,
  UNIQUE(role_key, permission_key)
);

CREATE TABLE IF NOT EXISTS sensitive_action_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id INTEGER NOT NULL,
  tenant_id INTEGER,
  action_key TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  review_state TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_hash_chain_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id TEXT NOT NULL UNIQUE,
  org_id TEXT NOT NULL,
  tenant_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  ip_or_context_ref TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  prev_hash TEXT,
  event_hash TEXT NOT NULL UNIQUE,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_audit_hash_chain_org_tenant_created
  ON audit_hash_chain_events(org_id, tenant_id, created_at);

CREATE TABLE IF NOT EXISTS inbound_security_assessments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  internal_message_id TEXT NOT NULL,
  message_id TEXT,
  spf_result TEXT NOT NULL DEFAULT 'UNKNOWN',
  dkim_result TEXT NOT NULL DEFAULT 'UNKNOWN',
  dmarc_result TEXT NOT NULL DEFAULT 'UNKNOWN',
  arc_result TEXT NOT NULL DEFAULT 'UNKNOWN',
  from_domain_alignment INTEGER NOT NULL DEFAULT 0,
  reply_to_mismatch INTEGER NOT NULL DEFAULT 0,
  display_name_spoof_flag INTEGER NOT NULL DEFAULT 0,
  attachment_risk INTEGER NOT NULL DEFAULT 0,
  url_risk INTEGER NOT NULL DEFAULT 0,
  spam_score INTEGER NOT NULL DEFAULT 0,
  phishing_score INTEGER NOT NULL DEFAULT 0,
  security_verdict TEXT NOT NULL CHECK(security_verdict IN ('PASS','WARN','SUSPICIOUS','QUARANTINE_RECOMMENDED','BLOCKED','UNKNOWN')),
  security_classification TEXT NOT NULL DEFAULT 'standard',
  quarantine_recommendation INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS message_lifecycle_state (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  internal_message_id TEXT NOT NULL UNIQUE,
  lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN ('ACTIVE','HELD','RETAINED','EXPIRED_PENDING','SOFT_DELETED','PURGE_ELIGIBLE','PURGED','REVOKED','DISABLED')) DEFAULT 'ACTIVE',
  legal_hold_active INTEGER NOT NULL DEFAULT 0,
  retention_minimum_until INTEGER,
  expires_at INTEGER,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS message_event_spine (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  internal_message_id TEXT,
  message_id TEXT,
  provider TEXT,
  delivery_truth_state TEXT NOT NULL DEFAULT 'unknown',
  audit_event_id TEXT,
  lifecycle_state TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_message_event_spine_internal_created
  ON message_event_spine(internal_message_id, created_at);

CREATE TABLE IF NOT EXISTS domain_reconciler_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  domain TEXT NOT NULL COLLATE NOCASE,
  desired_dns_json TEXT NOT NULL DEFAULT '[]',
  observed_dns_json TEXT NOT NULL DEFAULT '{}',
  plan_json TEXT NOT NULL DEFAULT '[]',
  drift_detected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
