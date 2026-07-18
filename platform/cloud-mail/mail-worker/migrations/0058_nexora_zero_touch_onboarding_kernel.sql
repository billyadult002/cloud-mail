-- NEXORA Zero-Touch onboarding kernel. Additive to 0037-0040/0057. The Durable Mission
-- Runtime (mission_runtime_missions, kind='ZERO_TOUCH_ONBOARDING') remains the sole state-
-- machine and evidence authority; the tables below are onboarding-specific projections and
-- the durable authorization-session contract, not a parallel Mission authority.
CREATE TABLE IF NOT EXISTS nexora_onboarding_state (
 mission_id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 target_provider TEXT NOT NULL, target_account_or_domain_hash TEXT NOT NULL,
 discovery_state TEXT NOT NULL DEFAULT 'discovering', authorization_state TEXT NOT NULL DEFAULT 'not_started',
 approval_state TEXT NOT NULL DEFAULT 'not_required', connection_state TEXT NOT NULL DEFAULT 'not_connected',
 capability_state TEXT NOT NULL DEFAULT 'not_discovered', sync_state TEXT NOT NULL DEFAULT 'not_started',
 verification_state TEXT NOT NULL DEFAULT 'not_verified', blocked_reason TEXT, required_human_actor TEXT,
 resume_token TEXT, final_verdict TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Durable authorization session -- survives process restart because it is D1-backed, not
-- in-memory. state/nonce/PKCE values are single-use; consumed_at enforces single consumption.
-- Only a hash of the code_verifier and PKCE challenge are stored (never the raw verifier),
-- consistent with "never record raw ... PKCE verifier" in this mission's audit requirements
-- -- the verifier itself lives only in the short-lived redirect target (client-side / signed
-- cookie), never persisted server-side in cleartext or otherwise queryable form.
CREATE TABLE IF NOT EXISTS nexora_onboarding_authorization_sessions (
 id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
 client_registration_mode TEXT NOT NULL CHECK(client_registration_mode IN ('first_party','byo_app')),
 redirect_uri_id TEXT NOT NULL, scopes_json TEXT NOT NULL, incremental_scopes_json TEXT NOT NULL DEFAULT '[]',
 state_hash TEXT NOT NULL, nonce_hash TEXT, pkce_challenge TEXT NOT NULL, pkce_challenge_method TEXT NOT NULL DEFAULT 'S256',
 pkce_verifier_hash TEXT NOT NULL, tenant_hint TEXT, login_hint_hash TEXT,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','consumed','expired','cancelled','error')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, consumed_at TEXT,
 callback_fingerprint TEXT, resume_checkpoint TEXT,
 UNIQUE(tenant_id,workspace_id,state_hash)
);
CREATE TABLE IF NOT EXISTS nexora_onboarding_capabilities (
 id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL, capability_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('SUPPORTED','UNSUPPORTED','CONSENT_REQUIRED','ADMIN_APPROVAL_REQUIRED','POLICY_DENIED','TEMPORARILY_UNAVAILABLE','DEGRADED')),
 reason_codes_json TEXT NOT NULL DEFAULT '[]', observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(onboarding_mission_id, capability_key)
);
CREATE INDEX IF NOT EXISTS idx_nexora_onboarding_state_scope ON nexora_onboarding_state(tenant_id,workspace_id,connection_state);
CREATE INDEX IF NOT EXISTS idx_nexora_onboarding_sessions_lookup ON nexora_onboarding_authorization_sessions(tenant_id,workspace_id,status,expires_at);
CREATE INDEX IF NOT EXISTS idx_nexora_onboarding_capabilities_scope ON nexora_onboarding_capabilities(tenant_id,workspace_id,onboarding_mission_id);
