-- Immutable callback-only verified-result authority. This record is distinct
-- from finalization coordination and Mission completion outcomes.
CREATE TABLE IF NOT EXISTS nexora_callback_verified_results (
 id TEXT PRIMARY KEY,
 finalization_operation_id TEXT NOT NULL,
 finalization_idempotency_key TEXT NOT NULL UNIQUE,
 verification_attempt_id TEXT NOT NULL UNIQUE,
 verifier_authorization_id TEXT NOT NULL UNIQUE,
 verification_policy_id TEXT NOT NULL,
 verification_generation INTEGER NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 mission_id TEXT NOT NULL,
 provider TEXT NOT NULL,
 authorization_session_id TEXT,
 callback_correlation_id TEXT NOT NULL,
 replacement_authorization_session_id TEXT,
 replacement_correlation_id TEXT,
 authority_tuple_digest TEXT NOT NULL,
 evidence_set_digest TEXT NOT NULL,
 atomic_callback_result_id TEXT NOT NULL,
 provider_outcome_result_id TEXT NOT NULL,
 token_generation INTEGER NOT NULL,
 provider_connection_id TEXT,
 provider_connection_generation INTEGER,
 canonical_evidence_references_json TEXT NOT NULL DEFAULT '[]',
 callback_outcome_verified_checkpoint_id TEXT NOT NULL,
 result_status TEXT NOT NULL CHECK(result_status='VERIFIED'),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(mission_id,callback_correlation_id,verification_generation)
);
CREATE INDEX IF NOT EXISTS idx_nexora_callback_verified_result_scope ON nexora_callback_verified_results(tenant_id,workspace_id,mission_id);
