-- NEXORA-owned callback recovery authority. This migration is independent of external
-- provider code and records no authorization code, verifier, token, or client secret.
CREATE TABLE IF NOT EXISTS nexora_onboarding_callback_claims (
 id TEXT PRIMARY KEY,
 correlation_id TEXT NOT NULL UNIQUE,
 authorization_session_id TEXT NOT NULL,
 onboarding_mission_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
 lease_owner TEXT, lease_acquired_at TEXT, lease_expires_at TEXT,
 fencing_token INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0,
 recovery_mode TEXT NOT NULL DEFAULT 'EXECUTION' CHECK(recovery_mode IN ('EXECUTION','RECONCILIATION','REAUTHORIZATION','TERMINAL')),
 claim_status TEXT NOT NULL DEFAULT 'AVAILABLE' CHECK(claim_status IN ('AVAILABLE','CLAIMED','PROCESSING','WAITING_FOR_RECONCILIATION','RECOVERABLE','COMPLETED','STALE','EXPIRED','BLOCKED','FAILED','CANCELLED')),
 last_heartbeat_at TEXT, takeover_count INTEGER NOT NULL DEFAULT 0,
 evidence_references_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nexora_callback_claim_recovery ON nexora_onboarding_callback_claims(claim_status,lease_expires_at);

CREATE TABLE IF NOT EXISTS nexora_onboarding_callback_checkpoints (
 id TEXT PRIMARY KEY, correlation_id TEXT NOT NULL, claim_id TEXT NOT NULL,
 fencing_token INTEGER NOT NULL, step TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('NOT_STARTED','INTENT_RECORDED','IN_PROGRESS','EXTERNAL_RESULT_OBSERVED','PERSISTED','VERIFIED','RETRYABLE','RECONCILIATION_REQUIRED','REAUTHORIZATION_REQUIRED','BLOCKED','FAILED')),
 attempt INTEGER NOT NULL DEFAULT 0, started_at TEXT, observed_at TEXT, persisted_at TEXT, completed_at TEXT,
 provider_operation_reference TEXT, token_generation_reference INTEGER, connection_reference TEXT, sync_job_reference TEXT,
 mission_checkpoint_reference TEXT, evidence_references_json TEXT NOT NULL DEFAULT '[]', last_error_code TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(correlation_id,step)
);
CREATE INDEX IF NOT EXISTS idx_nexora_callback_checkpoint_resume ON nexora_onboarding_callback_checkpoints(correlation_id,status,created_at);
