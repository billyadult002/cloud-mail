-- NEXORA-owned durable replacement-session authority.  It stores no OAuth state,
-- verifier, authorization code, access token, refresh token, or client secret.
CREATE TABLE IF NOT EXISTS nexora_onboarding_reauthorization_work (
 id TEXT PRIMARY KEY,
 original_correlation_id TEXT NOT NULL UNIQUE,
 original_authorization_session_id TEXT NOT NULL,
 replacement_authorization_session_id TEXT UNIQUE,
 onboarding_mission_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
 requested_capabilities_json TEXT NOT NULL DEFAULT '[]',
 scope_plan_reference TEXT,
 reason_code TEXT NOT NULL,
 idempotency_key TEXT NOT NULL UNIQUE,
 expected_token_generation INTEGER,
 lease_owner TEXT,
 lease_acquired_at TEXT,
 lease_expires_at TEXT,
 fencing_token INTEGER NOT NULL DEFAULT 0,
 attempt INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','CLAIMED','CREATING_SESSION','WAITING_FOR_USER','WAITING_FOR_ADMIN','AUTHORITY_RECEIVED','VALIDATING','COMPLETED','DEGRADED','BLOCKED','FAILED','CANCELLED')),
 evidence_references_json TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_nexora_reauthorization_lease ON nexora_onboarding_reauthorization_work(status,lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_nexora_reauthorization_scope ON nexora_onboarding_reauthorization_work(tenant_id,workspace_id,onboarding_mission_id);
