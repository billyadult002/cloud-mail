-- P0 durable Mission business truth. nexora_autonomy_jobs remains transport only.
CREATE TABLE IF NOT EXISTS mission_runtime_missions (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
 kind TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, idempotency_key TEXT NOT NULL,
 claim_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TEXT, UNIQUE(tenant_id,workspace_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS mission_runtime_runs (
 id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 state TEXT NOT NULL, fencing_token INTEGER NOT NULL DEFAULT 0, lease_until TEXT, version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS mission_runtime_steps (
 id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 step_key TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, checkpoint_seq INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(run_id,step_key)
);
CREATE TABLE IF NOT EXISTS mission_runtime_checkpoints (
 id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, step_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 seq INTEGER NOT NULL, fencing_token INTEGER NOT NULL, state TEXT NOT NULL, evidence_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(step_id,seq)
);
CREATE TABLE IF NOT EXISTS mission_runtime_actions (
 id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, step_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 capability TEXT NOT NULL, action_type TEXT NOT NULL, target_hash TEXT NOT NULL, params_hash TEXT NOT NULL, authority_generation INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL, idempotency_key TEXT NOT NULL, outbound_message_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS mission_runtime_approvals (
 id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, action_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 params_hash TEXT NOT NULL, authority_generation INTEGER NOT NULL, requester_id INTEGER NOT NULL, approver_id INTEGER, state TEXT NOT NULL,
 issued_at TEXT, expires_at TEXT, consumed_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS mission_runtime_evidence (
 id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, step_id TEXT NOT NULL, action_id TEXT, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 claim_key TEXT NOT NULL, source_type TEXT NOT NULL, status TEXT NOT NULL, reference_hash TEXT NOT NULL, summary_json TEXT NOT NULL DEFAULT '{}', observed_at TEXT NOT NULL, expires_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,reference_hash)
);
CREATE TABLE IF NOT EXISTS mission_runtime_verifications (
 id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, action_id TEXT, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 state TEXT NOT NULL, evidence_id TEXT NOT NULL, verifier TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS mission_runtime_outcomes (
 id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 state TEXT NOT NULL, verification_id TEXT NOT NULL, claim_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(mission_id,claim_key)
);
CREATE INDEX IF NOT EXISTS idx_mission_runtime_missions_scope ON mission_runtime_missions(tenant_id,workspace_id,state);
CREATE INDEX IF NOT EXISTS idx_mission_runtime_runs_lease ON mission_runtime_runs(state,lease_until);
