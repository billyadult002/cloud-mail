-- Immutable provider outcome authority for fenced refresh failure/revocation results.
--
-- idempotency_key is the STABLE OPERATION KEY: it identifies the logical operation (lease +
-- fence + generation + work item) and deliberately excludes mutable outcome values (health,
-- revocation reason, observation reference) so that two calls for the SAME operation with
-- DIFFERENT outcomes are recognized as a conflict rather than silently treated as two
-- unrelated operations. authority_tuple_digest is the immutable hash of the full authority
-- context (mission/tenant/workspace/provider/work/lease/fence/generation) the operation was
-- authorized against; outcome_digest is the immutable hash of the outcome-specific values.
-- Retry semantics: same operation key + same authority digest + same outcome digest -> return
-- the existing result, no mutation. Same operation key + same authority digest + different
-- outcome digest -> fail closed (OUTCOME_CONFLICT). Same operation key + different authority
-- digest -> fail closed (AUTHORITY_CONFLICT).
CREATE TABLE IF NOT EXISTS nexora_provider_outcome_results (
 id TEXT PRIMARY KEY,
 outcome_kind TEXT NOT NULL CHECK(outcome_kind IN ('SUCCESS','FAILURE','REVOCATION')),
 operation_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL UNIQUE,
 authority_tuple_digest TEXT NOT NULL,
 outcome_digest TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL,
 connection_id TEXT,
 mission_id TEXT NOT NULL,
 authorization_session_id TEXT,
 correlation_id TEXT,
 refresh_job_id TEXT,
 lease_owner TEXT NOT NULL,
 fencing_token INTEGER NOT NULL,
 expected_token_generation INTEGER NOT NULL,
 committed_token_generation INTEGER NOT NULL,
 expected_provider_connection_generation INTEGER,
 committed_provider_connection_generation INTEGER,
 observation_reference TEXT,
 normalized_reason_code TEXT NOT NULL,
 retry_classification TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 evidence_outbox_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_nexora_provider_outcome_scope ON nexora_provider_outcome_results(tenant_id,workspace_id,provider,mission_id);
