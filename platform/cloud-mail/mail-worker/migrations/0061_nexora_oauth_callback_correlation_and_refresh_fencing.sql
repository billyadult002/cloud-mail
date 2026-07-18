-- NEXORA release-blocker closure: callback correlation and refresh fencing are durable
-- projections.  mission_runtime_missions remains the authority for mission lifecycle.
CREATE TABLE IF NOT EXISTS nexora_onboarding_callback_correlations (
 id TEXT PRIMARY KEY,
 state_hash TEXT NOT NULL UNIQUE,
 authorization_session_id TEXT NOT NULL UNIQUE,
 onboarding_mission_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
 redirect_uri_id TEXT NOT NULL,
 redirect_uri_hash TEXT NOT NULL,
 requested_scopes_json TEXT NOT NULL,
 requested_capabilities_json TEXT NOT NULL DEFAULT '[]',
 scope_plan_reference TEXT,
 pkce_challenge TEXT NOT NULL,
 pkce_challenge_reference TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','claimed','consumed','expired','cancelled','error')),
 claim_token TEXT, claimed_at TEXT, claimed_by TEXT, claim_expires_at TEXT, claim_generation INTEGER NOT NULL DEFAULT 0,
 callback_fingerprint TEXT, resume_checkpoint TEXT, evidence_references_json TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, consumed_at TEXT, cancelled_at TEXT,
 FOREIGN KEY(authorization_session_id) REFERENCES nexora_onboarding_authorization_sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_nexora_callback_correlation_status ON nexora_onboarding_callback_correlations(status,expires_at);

-- A leased work item prevents two cron invocations (or a retry after eviction) from
-- concurrently rotating the same refresh credential.  expected_token_generation is the
-- fencing value used for the final conditional token update.
CREATE TABLE IF NOT EXISTS nexora_onboarding_refresh_work (
 id TEXT PRIMARY KEY,
 idempotency_key TEXT NOT NULL UNIQUE,
 onboarding_mission_id TEXT NOT NULL,
 connection_id TEXT,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
 expected_token_generation INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','completed','failed','revoked')),
 lease_token TEXT, lease_owner TEXT, lease_acquired_at TEXT, lease_expires_at TEXT, fence_generation INTEGER NOT NULL DEFAULT 0,
 attempt_count INTEGER NOT NULL DEFAULT 0, refresh_due_at TEXT, provider_request_started_at TEXT, provider_response_observed_at TEXT,
 commit_completed_at TEXT, next_retry_at TEXT, last_error_classification TEXT, last_error_code TEXT,
 evidence_references_json TEXT NOT NULL DEFAULT '[]', completed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nexora_refresh_work_claim ON nexora_onboarding_refresh_work(status,lease_expires_at,created_at);
