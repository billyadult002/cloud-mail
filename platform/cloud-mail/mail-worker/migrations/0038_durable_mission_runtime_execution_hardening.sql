-- Additive execution hardening for the durable Mission Runtime kernel.
-- The existing 0037 business entities remain the canonical state model.
CREATE TABLE IF NOT EXISTS mission_runtime_tool_calls (
 id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, step_id TEXT NOT NULL,
 action_id TEXT, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 tool_name TEXT NOT NULL, operation TEXT NOT NULL, state TEXT NOT NULL,
 request_hash TEXT NOT NULL, result_hash TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TEXT
);
CREATE TABLE IF NOT EXISTS mission_runtime_events (
 id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT, step_id TEXT, action_id TEXT,
 tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, event_type TEXT NOT NULL,
 from_state TEXT, to_state TEXT, expected_version INTEGER, fencing_token INTEGER,
 detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE mission_runtime_actions ADD COLUMN authority_context_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE mission_runtime_approvals ADD COLUMN authority_context_hash TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_mission_runtime_tool_calls_scope ON mission_runtime_tool_calls(tenant_id,workspace_id,mission_id);
CREATE INDEX IF NOT EXISTS idx_mission_runtime_events_scope ON mission_runtime_events(tenant_id,workspace_id,mission_id,created_at);
CREATE INDEX IF NOT EXISTS idx_mission_runtime_approvals_action ON mission_runtime_approvals(action_id,state,expires_at);
