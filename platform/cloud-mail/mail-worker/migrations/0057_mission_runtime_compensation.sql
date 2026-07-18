-- Durable Mission Runtime compensation records. Additive to 0037-0040; closes the
-- confirmed COMPENSATING/COMPENSATED gap identified in the kernel gap-verified audit
-- (NEXORA_KERNEL_GAP_VERIFIED_AUDIT_REPORT.md). A compensation record is the evidence
-- trail for reversing an already-executed action; it never replaces the original
-- action's evidence, only supersedes its business effect.
CREATE TABLE IF NOT EXISTS mission_runtime_compensations (
 id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL,
 original_action_id TEXT NOT NULL, compensation_action_id TEXT,
 tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 reason TEXT NOT NULL, authorization_reference TEXT NOT NULL,
 capability TEXT NOT NULL, provider_target_hash TEXT NOT NULL,
 attempt INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'pending'
  CHECK(state IN ('pending','dispatched','observed','verified','failed')),
 observed_result TEXT, verification_result TEXT, evidence_ids_json TEXT NOT NULL DEFAULT '[]',
 started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT,
 final_state TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(mission_id, original_action_id, attempt)
);
CREATE INDEX IF NOT EXISTS idx_mission_runtime_compensations_scope ON mission_runtime_compensations(tenant_id,workspace_id,mission_id,state);
