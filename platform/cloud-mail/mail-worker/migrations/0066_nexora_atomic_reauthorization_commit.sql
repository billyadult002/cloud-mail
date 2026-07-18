-- NEXORA atomic replacement-authority bookkeeping.  The canonical evidence ledger remains
-- mission_runtime_evidence; this outbox only makes its delivery transactional and retryable.
ALTER TABLE nexora_onboarding_reauthorization_work ADD COLUMN scope_plan_digest TEXT;

CREATE TABLE IF NOT EXISTS nexora_onboarding_reauthorization_commit_results (
 id TEXT PRIMARY KEY,
 reauthorization_work_id TEXT NOT NULL UNIQUE,
 idempotency_key TEXT NOT NULL UNIQUE,
 authority_tuple_hash TEXT NOT NULL,
 onboarding_mission_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
 replacement_authorization_session_id TEXT NOT NULL,
 replacement_correlation_id TEXT NOT NULL,
 expected_prior_checkpoint TEXT NOT NULL,
 expected_token_generation INTEGER,
 committed_token_generation INTEGER NOT NULL,
 callback_claim_id TEXT NOT NULL,
 fencing_token INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'COMMITTED' CHECK(status IN ('COMMITTED','EVIDENCE_PENDING','EVIDENCE_DELIVERED','FAILED')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nexora_reauth_commit_scope ON nexora_onboarding_reauthorization_commit_results(tenant_id,workspace_id,onboarding_mission_id);

CREATE TABLE IF NOT EXISTS nexora_onboarding_evidence_outbox (
 id TEXT PRIMARY KEY,
 commit_result_id TEXT NOT NULL UNIQUE,
 onboarding_mission_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 event_type TEXT NOT NULL,
 payload_json TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','DELIVERED','RETRYING','FAILED')),
 attempts INTEGER NOT NULL DEFAULT 0,
 delivered_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nexora_evidence_outbox_delivery ON nexora_onboarding_evidence_outbox(status,created_at);
