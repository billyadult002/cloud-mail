-- Atomic callback-finalization identity. This is an append-only coordination
-- record for the canonical Mission Runtime verifier; it is not a competing
-- verifier or Evidence Ledger.
CREATE TABLE IF NOT EXISTS nexora_callback_verified_outcome_finalizations (
 id TEXT PRIMARY KEY,
 operation_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL UNIQUE,
 authority_tuple_digest TEXT NOT NULL,
 evidence_set_digest TEXT NOT NULL,
 verification_attempt_id TEXT NOT NULL,
 verifier_authorization_id TEXT NOT NULL,
 verified_outcome_reference TEXT,
 callback_checkpoint_reference TEXT,
 expected_token_generation INTEGER NOT NULL,
 expected_provider_connection_generation INTEGER,
 state TEXT NOT NULL CHECK(state IN ('READY','FINALIZING','VERIFIED','BLOCKED','FAILED')),
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 mission_id TEXT NOT NULL,
 callback_correlation_id TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 finalized_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_nexora_callback_finalization_scope ON nexora_callback_verified_outcome_finalizations(tenant_id,workspace_id,mission_id,callback_correlation_id);
