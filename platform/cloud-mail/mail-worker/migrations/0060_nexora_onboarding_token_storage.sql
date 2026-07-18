-- Secure token lifecycle storage (Required Output #11). Reuses the same AES-GCM-at-rest
-- pattern already used for the Gmail App Password path (secret-crypto.js) -- no new crypto
-- primitive, no plaintext token column. refresh_token_ciphertext is the durable credential;
-- access tokens are short-lived and intentionally NOT persisted here (fetched on demand via
-- refresh, per OAuth best practice) -- access_token_ciphertext exists only for a provider
-- that issues a long-lived access token without rotation, and is nullable.
CREATE TABLE IF NOT EXISTS nexora_onboarding_tokens (
 id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')), provider_account_hash TEXT NOT NULL,
 refresh_token_ciphertext TEXT NOT NULL, access_token_ciphertext TEXT, access_token_expires_at TEXT,
 granted_scopes_json TEXT NOT NULL, rotation_generation INTEGER NOT NULL DEFAULT 1,
 connection_health TEXT NOT NULL DEFAULT 'healthy' CHECK(connection_health IN ('healthy','degraded','revoked','unknown')),
 last_successful_refresh_at TEXT, last_failed_refresh_at TEXT, refresh_failure_count INTEGER NOT NULL DEFAULT 0,
 revoked_at TEXT, revoked_reason TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(onboarding_mission_id)
);
CREATE INDEX IF NOT EXISTS idx_nexora_onboarding_tokens_scope ON nexora_onboarding_tokens(tenant_id,workspace_id,connection_health);
