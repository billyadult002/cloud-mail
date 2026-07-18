-- Durable callback-verifier attempt and authorization records.
-- These records are immutable authority inputs for the canonical Mission Runtime
-- verifier; callers cannot manufacture verifier authorization from request data.
CREATE TABLE IF NOT EXISTS nexora_callback_verifier_authorizations (
 id TEXT PRIMARY KEY,
 verification_generation INTEGER NOT NULL,
 verifier_identity TEXT NOT NULL,
 authority_digest TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 mission_id TEXT NOT NULL,
 callback_correlation_id TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 consumed_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,mission_id,verification_generation)
);
CREATE TABLE IF NOT EXISTS nexora_callback_verification_attempts (
 id TEXT PRIMARY KEY,
 verification_policy_id TEXT NOT NULL,
 verification_generation INTEGER NOT NULL,
 idempotency_key TEXT NOT NULL UNIQUE,
 evidence_set_digest TEXT NOT NULL,
 authority_tuple_digest TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 mission_id TEXT NOT NULL,
 callback_correlation_id TEXT NOT NULL,
 verifier_authorization_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('PENDING','FAILED','VERIFIED')),
 result_json TEXT NOT NULL DEFAULT '{}',
 failure_classification TEXT,
 canonical_evidence_refs_json TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 verified_at TEXT,
 FOREIGN KEY(verifier_authorization_id) REFERENCES nexora_callback_verifier_authorizations(id)
);
CREATE INDEX IF NOT EXISTS idx_nexora_callback_verifier_attempt_scope ON nexora_callback_verification_attempts(tenant_id,workspace_id,mission_id,callback_correlation_id);
