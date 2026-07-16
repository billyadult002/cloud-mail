-- Provider-agnostic, append-preserving communication intelligence P0.
CREATE TABLE IF NOT EXISTS communication_classification_runs (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, account_id INTEGER NOT NULL,
 conversation_key TEXT NOT NULL, message_id INTEGER NOT NULL, input_hash TEXT NOT NULL, classifier_version TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('running','completed','failed')), fencing_token INTEGER NOT NULL DEFAULT 1, processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,message_id,classifier_version)
);
CREATE TABLE IF NOT EXISTS communication_layer_results (
 id TEXT PRIMARY KEY, run_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 account_id INTEGER NOT NULL, conversation_key TEXT NOT NULL, message_id INTEGER NOT NULL, layer_key TEXT NOT NULL,
 layer_order INTEGER NOT NULL, contract_version INTEGER NOT NULL, output_json TEXT NOT NULL, status TEXT NOT NULL,
 confidence REAL NOT NULL CHECK(confidence>=0 AND confidence<=1), evidence_hash TEXT NOT NULL, provenance TEXT NOT NULL, sensitivity TEXT NOT NULL,
 supersedes_id TEXT, observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(run_id,layer_key)
);
CREATE TABLE IF NOT EXISTS communication_conversation_states (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, account_id INTEGER NOT NULL,
 conversation_key TEXT NOT NULL, version INTEGER NOT NULL, message_count INTEGER NOT NULL, last_message_id INTEGER NOT NULL,
 state_json TEXT NOT NULL, evidence_hash TEXT NOT NULL, supersedes_id TEXT, state TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(tenant_id,workspace_id,conversation_key,version)
);
CREATE TABLE IF NOT EXISTS communication_commitments (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, conversation_key TEXT NOT NULL,
 source_message_id INTEGER NOT NULL, business_key TEXT NOT NULL, committed_party_ref TEXT, beneficiary_ref TEXT,
 normalized_commitment TEXT NOT NULL, deadline_at TEXT, state TEXT NOT NULL, confidence REAL NOT NULL,
 evidence_hash TEXT NOT NULL, verification_state TEXT NOT NULL, supersedes_id TEXT, cancellation_reason TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,business_key)
);
CREATE TABLE IF NOT EXISTS communication_commitment_events (
 id TEXT PRIMARY KEY, commitment_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 event_type TEXT NOT NULL, from_state TEXT, to_state TEXT NOT NULL, evidence_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS communication_mission_candidates (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, conversation_key TEXT NOT NULL,
 triggering_message_ids_json TEXT NOT NULL, classification_run_ids_json TEXT NOT NULL, commitment_id TEXT,
 required_claims_json TEXT NOT NULL, evidence_hash TEXT NOT NULL, risk_class TEXT NOT NULL,
 duplicate_key TEXT NOT NULL, policy_version TEXT NOT NULL, proposed_objective TEXT NOT NULL,
 decision TEXT NOT NULL, reason_codes_json TEXT NOT NULL, mission_id TEXT,
 supersedes_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS communication_evaluation_cases (
 id TEXT PRIMARY KEY, dataset_version TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 fixture_type TEXT NOT NULL, feature_json TEXT NOT NULL, gold_json TEXT NOT NULL, label_source TEXT NOT NULL,
 reviewer_ref TEXT NOT NULL, sensitivity TEXT NOT NULL DEFAULT 'synthetic_or_structured', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS communication_metric_observations (
 id TEXT PRIMARY KEY, dataset_version TEXT NOT NULL, classifier_version TEXT NOT NULL, metric_key TEXT NOT NULL,
 metric_value REAL NOT NULL, threshold_value REAL NOT NULL, passed INTEGER NOT NULL, scope TEXT NOT NULL,
 observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS communication_drift_observations (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, classifier_version TEXT NOT NULL,
 layer_key TEXT NOT NULL, processed_count INTEGER NOT NULL, abstention_count INTEGER NOT NULL,
 conflict_count INTEGER NOT NULL, latency_ms INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TRIGGER IF NOT EXISTS communication_layer_no_update BEFORE UPDATE ON communication_layer_results BEGIN SELECT RAISE(ABORT,'classification_history_append_only'); END;
CREATE TRIGGER IF NOT EXISTS communication_layer_no_delete BEFORE DELETE ON communication_layer_results BEGIN SELECT RAISE(ABORT,'classification_history_append_only'); END;
CREATE TRIGGER IF NOT EXISTS communication_commitment_event_no_update BEFORE UPDATE ON communication_commitment_events BEGIN SELECT RAISE(ABORT,'commitment_history_append_only'); END;
CREATE INDEX IF NOT EXISTS idx_classification_message ON communication_classification_runs(tenant_id,workspace_id,message_id,processed_at);
CREATE INDEX IF NOT EXISTS idx_layer_conversation ON communication_layer_results(tenant_id,workspace_id,conversation_key,layer_order);
CREATE INDEX IF NOT EXISTS idx_conversation_current ON communication_conversation_states(tenant_id,workspace_id,conversation_key,version);
CREATE INDEX IF NOT EXISTS idx_commitment_state ON communication_commitments(tenant_id,workspace_id,state,deadline_at);
CREATE INDEX IF NOT EXISTS idx_mission_candidate_decision ON communication_mission_candidates(tenant_id,workspace_id,decision,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_one_current ON communication_conversation_states(tenant_id,workspace_id,conversation_key) WHERE state='current';
CREATE INDEX IF NOT EXISTS idx_mission_candidate_duplicate ON communication_mission_candidates(tenant_id,workspace_id,duplicate_key,policy_version,created_at);
