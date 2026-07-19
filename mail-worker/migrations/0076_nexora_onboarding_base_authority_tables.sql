-- NEXORA production provider acceptance: base onboarding authority tables.
-- This forward-only migration creates the durable state required before a real
-- provider authorization session can be started. It stores hashes, ciphertext,
-- leases, generations, and evidence references only; raw OAuth codes, PKCE
-- verifiers, cookies, provider payloads, and credential values must never be
-- persisted here.

CREATE TABLE IF NOT EXISTS nexora_onboarding_state (
 mission_id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 target_provider TEXT NOT NULL,
 target_account_or_domain_hash TEXT NOT NULL,
 discovery_state TEXT NOT NULL DEFAULT 'discovering',
 authorization_state TEXT NOT NULL DEFAULT 'not_started',
 approval_state TEXT NOT NULL DEFAULT 'not_required',
 connection_state TEXT NOT NULL DEFAULT 'not_connected',
 capability_state TEXT NOT NULL DEFAULT 'not_discovered',
 sync_state TEXT NOT NULL DEFAULT 'not_started',
 verification_state TEXT NOT NULL DEFAULT 'not_verified',
 blocked_reason TEXT,
 required_human_actor TEXT,
 resume_token TEXT,
 final_verdict TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 phase TEXT NOT NULL DEFAULT 'discovering' CHECK(phase IN (
  'discovering','provider_identified','authorization_path_selected',
  'waiting_for_user_login','waiting_for_user_consent','waiting_for_admin_consent','waiting_for_provider_review',
  'authorization_received','validating_authority','discovering_capabilities','provisioning',
  'verifying_connection','starting_initial_sync','verifying_initial_sync',
  'connected','degraded','blocked','failed','cancelled'
 )),
 phase_version INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_nexora_onboarding_state_scope ON nexora_onboarding_state(tenant_id,workspace_id,phase);

CREATE TABLE IF NOT EXISTS nexora_onboarding_authorization_sessions (
 id TEXT PRIMARY KEY,
 onboarding_mission_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
 client_registration_mode TEXT NOT NULL CHECK(client_registration_mode IN ('first_party','byo_app')),
 redirect_uri_id TEXT NOT NULL,
 scopes_json TEXT NOT NULL,
 incremental_scopes_json TEXT NOT NULL DEFAULT '[]',
 state_hash TEXT NOT NULL,
 nonce_hash TEXT,
 pkce_challenge TEXT NOT NULL,
 pkce_challenge_method TEXT NOT NULL DEFAULT 'S256',
 pkce_verifier_hash TEXT NOT NULL,
 tenant_hint TEXT,
 login_hint_hash TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','consumed','expired','cancelled','error')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at TEXT NOT NULL,
 consumed_at TEXT,
 callback_fingerprint TEXT,
 resume_checkpoint TEXT,
 UNIQUE(tenant_id,workspace_id,state_hash)
);
CREATE INDEX IF NOT EXISTS idx_nexora_auth_sessions_mission ON nexora_onboarding_authorization_sessions(onboarding_mission_id,created_at);
CREATE INDEX IF NOT EXISTS idx_nexora_auth_sessions_status ON nexora_onboarding_authorization_sessions(status,expires_at);

CREATE TABLE IF NOT EXISTS nexora_onboarding_tokens (
 id TEXT PRIMARY KEY,
 onboarding_mission_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
 provider_account_hash TEXT NOT NULL,
 refresh_token_ciphertext TEXT NOT NULL,
 access_token_ciphertext TEXT,
 access_token_expires_at TEXT,
 granted_scopes_json TEXT NOT NULL,
 rotation_generation INTEGER NOT NULL DEFAULT 1,
 connection_health TEXT NOT NULL DEFAULT 'healthy' CHECK(connection_health IN ('healthy','degraded','revoked','unknown')),
 last_successful_refresh_at TEXT,
 last_failed_refresh_at TEXT,
 refresh_failure_count INTEGER NOT NULL DEFAULT 0,
 revoked_at TEXT,
 revoked_reason TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(onboarding_mission_id)
);
CREATE INDEX IF NOT EXISTS idx_nexora_tokens_scope ON nexora_onboarding_tokens(tenant_id,workspace_id,provider,onboarding_mission_id);
CREATE INDEX IF NOT EXISTS idx_nexora_tokens_refresh_due ON nexora_onboarding_tokens(revoked_at,access_token_expires_at);

CREATE TABLE IF NOT EXISTS nexora_onboarding_capabilities (
 id TEXT PRIMARY KEY,
 onboarding_mission_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL,
 capability_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('SUPPORTED','UNSUPPORTED','CONSENT_REQUIRED','ADMIN_APPROVAL_REQUIRED','POLICY_DENIED','TEMPORARILY_UNAVAILABLE','DEGRADED')),
 reason_codes_json TEXT NOT NULL DEFAULT '[]',
 observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(onboarding_mission_id,capability_key)
);
CREATE INDEX IF NOT EXISTS idx_nexora_capabilities_scope ON nexora_onboarding_capabilities(tenant_id,workspace_id,provider,capability_key);

CREATE TABLE IF NOT EXISTS nexora_initial_sync_intents (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 mission_id TEXT NOT NULL,
 callback_correlation_id TEXT NOT NULL,
 state TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nexora_sync_intents_scope ON nexora_initial_sync_intents(tenant_id,workspace_id,mission_id,state);

CREATE TABLE IF NOT EXISTS nexora_initial_sync_dispatches (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 mission_id TEXT NOT NULL,
 intent_id TEXT NOT NULL,
 state TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nexora_sync_dispatches_scope ON nexora_initial_sync_dispatches(tenant_id,workspace_id,mission_id,state);

CREATE TABLE IF NOT EXISTS nexora_onboarding_notifications (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 mission_id TEXT NOT NULL,
 state TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nexora_notifications_scope ON nexora_onboarding_notifications(tenant_id,workspace_id,mission_id,state);
