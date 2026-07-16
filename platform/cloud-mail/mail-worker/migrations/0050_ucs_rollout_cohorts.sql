-- Explicit rollout membership keeps the Internal stage deterministic without
-- weakening the stable percentage cohort used for later production stages.
CREATE TABLE IF NOT EXISTS conversation_rollout_cohorts (
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 subject_user_id INTEGER NOT NULL,
 stage_key TEXT NOT NULL CHECK(stage_key IN ('internal')),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 authorized_by TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,workspace_id,subject_user_id,stage_key)
);

CREATE INDEX IF NOT EXISTS idx_ucs_rollout_cohorts_subject
 ON conversation_rollout_cohorts(subject_user_id,workspace_id,enabled);
