-- NEXORA evidence-first hybrid classification authority.
-- Stores redacted message fingerprints, category/attribute decisions, explicit
-- correction authority, and evidence reason codes. It must not store raw
-- provider payloads, credentials, tokens, OAuth state, PKCE verifiers, session
-- cookies, raw device identifiers, or private message bodies.

CREATE TABLE IF NOT EXISTS nexora_domain_authorities (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 normalized_domain TEXT NOT NULL,
 verification_status TEXT NOT NULL CHECK(verification_status IN ('verified','revoked','pending','failed')),
 verification_method TEXT NOT NULL,
 verification_evidence_ref TEXT NOT NULL,
 administrator_authority_ref TEXT,
 generation INTEGER NOT NULL DEFAULT 1,
 revoked_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,normalized_domain)
);
CREATE INDEX IF NOT EXISTS idx_nexora_domain_authorities_scope ON nexora_domain_authorities(tenant_id,workspace_id,normalized_domain,verification_status);

CREATE TABLE IF NOT EXISTS nexora_email_classifications (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL,
 provider_account_hash TEXT NOT NULL,
 customer_domain TEXT NOT NULL,
 message_fingerprint TEXT NOT NULL,
 thread_fingerprint TEXT,
 primary_category TEXT NOT NULL CHECK(primary_category IN (
  'PERSONAL','BUSINESS','TRANSACTIONAL','NOTIFICATION','NEWSLETTER',
  'PROMOTION','SOCIAL','SPAM','SUSPICIOUS','UNCLASSIFIED'
 )),
 vip_relationship INTEGER NOT NULL DEFAULT 0 CHECK(vip_relationship IN (0,1)),
 priority_level TEXT NOT NULL DEFAULT 'NONE' CHECK(priority_level IN ('NONE','LOW','NORMAL','HIGH','CRITICAL')),
 requires_action INTEGER NOT NULL DEFAULT 0 CHECK(requires_action IN (0,1)),
 time_sensitive INTEGER NOT NULL DEFAULT 0 CHECK(time_sensitive IN (0,1)),
 unread INTEGER NOT NULL DEFAULT 0 CHECK(unread IN (0,1)),
 starred INTEGER NOT NULL DEFAULT 0 CHECK(starred IN (0,1)),
 has_attachment INTEGER NOT NULL DEFAULT 0 CHECK(has_attachment IN (0,1)),
 confidence INTEGER NOT NULL CHECK(confidence BETWEEN 0 AND 100),
 reason_codes_json TEXT NOT NULL,
 conflicting_signals_json TEXT NOT NULL DEFAULT '[]',
 classifier_version TEXT NOT NULL,
 rules_version TEXT NOT NULL,
 model_version TEXT,
 authority_source TEXT NOT NULL CHECK(authority_source IN ('DETERMINISTIC_RULES','USER_OVERRIDE','ADMIN_POLICY','DIRECTORY_POLICY','MISSION_AUTHORITY','AI_ADVISORY','PROVIDER_NATIVE','MIXED')),
 vip_authority_ref TEXT,
 user_override_ref TEXT,
 administrator_override_ref TEXT,
 evidence_ref TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 generation INTEGER NOT NULL DEFAULT 1,
 classified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,provider,provider_account_hash,message_fingerprint),
 UNIQUE(tenant_id,workspace_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_nexora_email_classifications_scope ON nexora_email_classifications(tenant_id,workspace_id,customer_domain,primary_category);
CREATE INDEX IF NOT EXISTS idx_nexora_email_classifications_vip ON nexora_email_classifications(tenant_id,workspace_id,vip_relationship,vip_authority_ref);
CREATE INDEX IF NOT EXISTS idx_nexora_email_classifications_attr ON nexora_email_classifications(tenant_id,workspace_id,priority_level,requires_action,time_sensitive);

CREATE TABLE IF NOT EXISTS nexora_email_classification_corrections (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL,
 provider_account_hash TEXT NOT NULL,
 message_fingerprint TEXT NOT NULL,
 correction_type TEXT NOT NULL CHECK(correction_type IN (
  'MOVE_TO_VIP','REMOVE_FROM_VIP','MARK_PRIORITY','REMOVE_PRIORITY',
  'REQUIRES_ACTION','DOES_NOT_REQUIRE_ACTION','MARK_TRANSACTIONAL',
  'MARK_NOTIFICATION','MARK_NEWSLETTER','MARK_PROMOTION','MARK_SOCIAL',
  'MARK_SPAM','MARK_NOT_SPAM'
 )),
 authority_source TEXT NOT NULL CHECK(authority_source IN ('USER','ADMIN')),
 authority_ref TEXT NOT NULL,
 reason_codes_json TEXT NOT NULL DEFAULT '[]',
 idempotency_key TEXT NOT NULL,
 generation INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_nexora_email_corrections_message ON nexora_email_classification_corrections(tenant_id,workspace_id,provider,provider_account_hash,message_fingerprint,created_at);

CREATE TABLE IF NOT EXISTS nexora_email_classification_evidence (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL,
 customer_domain TEXT NOT NULL,
 message_fingerprint TEXT NOT NULL,
 evidence_kind TEXT NOT NULL,
 evidence_json TEXT NOT NULL,
 redaction_level TEXT NOT NULL DEFAULT 'BODYLESS',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nexora_email_classification_evidence_message ON nexora_email_classification_evidence(tenant_id,workspace_id,message_fingerprint,created_at);
