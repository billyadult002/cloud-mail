-- Additive Evidence Ledger and Verified Action Boundary P0.
-- mission_runtime_evidence remains the one canonical evidence ledger; no parallel store.
CREATE TABLE IF NOT EXISTS mission_runtime_claims (
 id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, step_id TEXT NOT NULL,
 action_id TEXT, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 claim_key TEXT NOT NULL, claim_type TEXT NOT NULL, subject_hash TEXT NOT NULL,
 assertion_hash TEXT NOT NULL, required_evidence_json TEXT NOT NULL,
 policy_id TEXT NOT NULL, policy_version INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(mission_id, claim_key)
);
CREATE TABLE IF NOT EXISTS mission_runtime_verification_policies (
 id TEXT NOT NULL, version INTEGER NOT NULL, claim_type TEXT NOT NULL,
 required_evidence_json TEXT NOT NULL, freshness_seconds INTEGER NOT NULL,
 minimum_distinct_evidence INTEGER NOT NULL DEFAULT 1, conflict_mode TEXT NOT NULL DEFAULT 'reject',
 active INTEGER NOT NULL DEFAULT 1, policy_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(id, version)
);
ALTER TABLE mission_runtime_evidence ADD COLUMN evidence_type TEXT NOT NULL DEFAULT 'provider_observation';
ALTER TABLE mission_runtime_evidence ADD COLUMN producer_type TEXT NOT NULL DEFAULT 'controlled_system';
ALTER TABLE mission_runtime_evidence ADD COLUMN producer_id_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE mission_runtime_evidence ADD COLUMN integrity_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE mission_runtime_evidence ADD COLUMN sensitivity TEXT NOT NULL DEFAULT 'restricted_metadata';
ALTER TABLE mission_runtime_evidence ADD COLUMN retention_class TEXT NOT NULL DEFAULT 'runtime_audit';
ALTER TABLE mission_runtime_evidence ADD COLUMN valid_from TEXT;
ALTER TABLE mission_runtime_evidence ADD COLUMN valid_until TEXT;
ALTER TABLE mission_runtime_evidence ADD COLUMN superseded_at TEXT;
ALTER TABLE mission_runtime_evidence ADD COLUMN revoked_at TEXT;
ALTER TABLE mission_runtime_evidence ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
CREATE TABLE IF NOT EXISTS mission_runtime_evidence_relations (
 id TEXT PRIMARY KEY, evidence_id TEXT NOT NULL, related_evidence_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 relation_type TEXT NOT NULL CHECK(relation_type IN ('supersedes','confirms','contradicts','duplicates','revokes')),
 reason_code TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(evidence_id, related_evidence_id, relation_type)
);
CREATE TABLE IF NOT EXISTS mission_runtime_verification_evidence (
 verification_id TEXT NOT NULL, evidence_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 disposition TEXT NOT NULL CHECK(disposition IN ('used','rejected')),
 reason_code TEXT NOT NULL, evidence_integrity_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(verification_id, evidence_id)
);
ALTER TABLE mission_runtime_verifications ADD COLUMN claim_id TEXT;
ALTER TABLE mission_runtime_verifications ADD COLUMN policy_id TEXT;
ALTER TABLE mission_runtime_verifications ADD COLUMN policy_version INTEGER;
ALTER TABLE mission_runtime_verifications ADD COLUMN evidence_set_hash TEXT NOT NULL DEFAULT '';
ALTER TABLE mission_runtime_verifications ADD COLUMN reason_codes_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE mission_runtime_verifications ADD COLUMN integrity_state TEXT NOT NULL DEFAULT 'valid';
ALTER TABLE mission_runtime_verifications ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE mission_runtime_outcomes ADD COLUMN action_id TEXT;
ALTER TABLE mission_runtime_outcomes ADD COLUMN policy_id TEXT;
ALTER TABLE mission_runtime_outcomes ADD COLUMN policy_version INTEGER;
ALTER TABLE mission_runtime_outcomes ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
CREATE TRIGGER IF NOT EXISTS mission_runtime_evidence_no_update
BEFORE UPDATE ON mission_runtime_evidence BEGIN SELECT RAISE(ABORT, 'mission_runtime_evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS mission_runtime_evidence_no_delete
BEFORE DELETE ON mission_runtime_evidence BEGIN SELECT RAISE(ABORT, 'mission_runtime_evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS mission_runtime_claims_no_delete
BEFORE DELETE ON mission_runtime_claims BEGIN SELECT RAISE(ABORT, 'mission_runtime_claim_history_append_only'); END;
CREATE INDEX IF NOT EXISTS idx_mission_runtime_claim_scope ON mission_runtime_claims(tenant_id,workspace_id,mission_id,claim_key);
CREATE INDEX IF NOT EXISTS idx_mission_runtime_evidence_claim ON mission_runtime_evidence(tenant_id,workspace_id,mission_id,claim_key,observed_at);
CREATE INDEX IF NOT EXISTS idx_mission_runtime_evidence_relation ON mission_runtime_evidence_relations(tenant_id,workspace_id,evidence_id,related_evidence_id);
