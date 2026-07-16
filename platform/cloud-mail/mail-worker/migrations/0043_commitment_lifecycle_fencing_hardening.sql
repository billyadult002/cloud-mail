-- Classification/Commitment P0: additive database fencing, CAS, verification and quarantine.
ALTER TABLE nexora_autonomy_jobs ADD COLUMN fencing_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE communication_classification_runs ADD COLUMN job_id INTEGER;
ALTER TABLE communication_classification_runs ADD COLUMN fencing_generation INTEGER;
ALTER TABLE communication_layer_results ADD COLUMN job_id INTEGER;
ALTER TABLE communication_layer_results ADD COLUMN fencing_generation INTEGER;
ALTER TABLE communication_layer_results ADD COLUMN input_hash TEXT;
ALTER TABLE communication_conversation_states ADD COLUMN job_id INTEGER;
ALTER TABLE communication_conversation_states ADD COLUMN fencing_generation INTEGER;
ALTER TABLE communication_conversation_states ADD COLUMN input_hash TEXT;
ALTER TABLE communication_conversation_states ADD COLUMN message_set_digest TEXT;
ALTER TABLE communication_commitments ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE communication_commitments ADD COLUMN account_id INTEGER;
ALTER TABLE communication_commitments ADD COLUMN source_run_id TEXT;
ALTER TABLE communication_commitments ADD COLUMN input_hash TEXT;
ALTER TABLE communication_commitments ADD COLUMN job_id INTEGER;
ALTER TABLE communication_commitments ADD COLUMN fencing_generation INTEGER;
ALTER TABLE communication_commitments ADD COLUMN authority_generation_state TEXT NOT NULL DEFAULT 'not_applicable';
ALTER TABLE communication_commitments ADD COLUMN authority_generation INTEGER;
ALTER TABLE communication_commitments ADD COLUMN legacy_scope_state TEXT NOT NULL DEFAULT 'pending_resolution';
ALTER TABLE communication_commitments ADD COLUMN activated_at TEXT;
ALTER TABLE communication_commitments ADD COLUMN fulfilled_at TEXT;
ALTER TABLE communication_commitments ADD COLUMN terminal_at TEXT;
ALTER TABLE communication_commitment_events ADD COLUMN account_id INTEGER;
ALTER TABLE communication_commitment_events ADD COLUMN commitment_version INTEGER;
ALTER TABLE communication_commitment_events ADD COLUMN verification_id TEXT;
ALTER TABLE communication_commitment_events ADD COLUMN transition_authorization_id TEXT;
ALTER TABLE communication_commitment_events ADD COLUMN source_message_id INTEGER;
ALTER TABLE communication_commitment_events ADD COLUMN classification_run_id TEXT;
ALTER TABLE communication_commitment_events ADD COLUMN input_hash TEXT;
ALTER TABLE communication_commitment_events ADD COLUMN committed_party_ref TEXT;
ALTER TABLE communication_commitment_events ADD COLUMN requested_transition TEXT;
ALTER TABLE communication_commitment_events ADD COLUMN authority_generation INTEGER;
ALTER TABLE communication_commitment_events ADD COLUMN job_id INTEGER;
ALTER TABLE communication_commitment_events ADD COLUMN fencing_generation INTEGER;
ALTER TABLE communication_mission_candidates ADD COLUMN account_id INTEGER;
ALTER TABLE communication_mission_candidates ADD COLUMN conversation_version INTEGER;
ALTER TABLE communication_mission_candidates ADD COLUMN input_hash TEXT;
ALTER TABLE communication_mission_candidates ADD COLUMN job_id INTEGER;
ALTER TABLE communication_mission_candidates ADD COLUMN fencing_generation INTEGER;
ALTER TABLE mission_runtime_missions ADD COLUMN classification_job_id INTEGER;
ALTER TABLE mission_runtime_missions ADD COLUMN classification_fencing_generation INTEGER;
ALTER TABLE mission_runtime_missions ADD COLUMN classification_input_hash TEXT;
ALTER TABLE mission_runtime_evidence ADD COLUMN classification_job_id INTEGER;
ALTER TABLE mission_runtime_evidence ADD COLUMN classification_fencing_generation INTEGER;
ALTER TABLE mission_runtime_evidence ADD COLUMN classification_input_hash TEXT;
ALTER TABLE mission_runtime_verifications ADD COLUMN classification_job_id INTEGER;
ALTER TABLE mission_runtime_verifications ADD COLUMN classification_fencing_generation INTEGER;
ALTER TABLE mission_runtime_verifications ADD COLUMN classification_input_hash TEXT;

CREATE TABLE communication_conversation_cas_authorizations (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, account_id INTEGER NOT NULL,
 conversation_key TEXT NOT NULL, expected_current_id TEXT, expected_version INTEGER NOT NULL, expected_state TEXT NOT NULL,
 message_set_json TEXT NOT NULL, message_set_digest TEXT NOT NULL, input_hash TEXT NOT NULL, job_id INTEGER NOT NULL,
 fencing_generation INTEGER NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE communication_commitment_verifications (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, account_id INTEGER NOT NULL,
 commitment_id TEXT NOT NULL, commitment_version INTEGER NOT NULL, conversation_key TEXT NOT NULL, source_message_id INTEGER NOT NULL,
 classification_run_id TEXT NOT NULL, input_hash TEXT NOT NULL, committed_party_ref TEXT NOT NULL,
 authority_generation_state TEXT NOT NULL CHECK(authority_generation_state IN ('bound','not_applicable')), authority_generation INTEGER,
 requested_transition TEXT NOT NULL, policy_id TEXT NOT NULL, policy_version INTEGER NOT NULL, evidence_ids_json TEXT NOT NULL,
 evidence_set_hash TEXT NOT NULL, verifier TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN ('verified','rejected','inconclusive')),
 observed_at TEXT NOT NULL, expires_at TEXT NOT NULL, job_id INTEGER NOT NULL, fencing_generation INTEGER NOT NULL, consumed_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE communication_transition_authorizations (
 id TEXT PRIMARY KEY, commitment_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, account_id INTEGER NOT NULL,
 from_state TEXT NOT NULL, to_state TEXT NOT NULL, expected_version INTEGER NOT NULL, verification_id TEXT NOT NULL,
 evidence_set_hash TEXT NOT NULL, source_message_id INTEGER NOT NULL, classification_run_id TEXT NOT NULL, input_hash TEXT NOT NULL,
 committed_party_ref TEXT NOT NULL, authority_generation_state TEXT NOT NULL, authority_generation INTEGER, job_id INTEGER NOT NULL,
 fencing_generation INTEGER NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT
);
CREATE TABLE communication_deadlines (
 id TEXT PRIMARY KEY, commitment_id TEXT NOT NULL, commitment_version INTEGER NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 account_id INTEGER NOT NULL, conversation_key TEXT NOT NULL, source_message_id INTEGER NOT NULL, classification_run_id TEXT NOT NULL,
 input_hash TEXT NOT NULL, source_expression_ref TEXT NOT NULL, expression_hash TEXT NOT NULL, normalized_start TEXT, normalized_end TEXT,
 timezone TEXT, precision TEXT NOT NULL CHECK(precision IN ('exact','day','range','relative','ambiguous','unknown')),
 deadline_type TEXT NOT NULL CHECK(deadline_type IN ('explicit','inferred','relative','ambiguous','range','unknown')),
 normalization_version TEXT NOT NULL, evidence_ids_json TEXT NOT NULL, evidence_set_hash TEXT NOT NULL, verification_id TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('current','superseded','cancelled')), supersedes_id TEXT, deadline_version INTEGER NOT NULL,
 job_id INTEGER NOT NULL, fencing_generation INTEGER NOT NULL, observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(commitment_id,expression_hash,normalization_version,verification_id)
);
CREATE TABLE communication_job_checkpoints (
 id TEXT PRIMARY KEY, job_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, account_id INTEGER NOT NULL,
 message_id INTEGER NOT NULL, stage TEXT NOT NULL, fencing_generation INTEGER NOT NULL, run_id TEXT, input_hash TEXT NOT NULL,
 state_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(job_id,fencing_generation,stage)
);
CREATE TABLE communication_fencing_rejections (
 id TEXT PRIMARY KEY, job_id INTEGER NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, expected_generation INTEGER NOT NULL,
 actual_generation INTEGER NOT NULL, attempted_stage TEXT NOT NULL, reason_code TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE communication_legacy_scope_quarantine (
 commitment_id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 resolution_state TEXT NOT NULL CHECK(resolution_state IN ('safely_backfilled','quarantined_read_only','needs_review','excluded_from_activation')),
 authoritative_run_id TEXT, resolved_account_id INTEGER, reason_code TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE communication_release_evaluations (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, window_start TEXT NOT NULL, window_end TEXT NOT NULL,
 classifier_version TEXT NOT NULL, policy_version TEXT NOT NULL, counters_json TEXT NOT NULL, unavailable_json TEXT NOT NULL,
 passed INTEGER NOT NULL, query_digest TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- A legacy record may only become scoped when exactly one immutable run proves its account identity.
UPDATE communication_commitments SET account_id=(SELECT MIN(r.account_id) FROM communication_classification_runs r WHERE r.tenant_id=communication_commitments.tenant_id AND r.workspace_id=communication_commitments.workspace_id AND r.conversation_key=communication_commitments.conversation_key AND r.message_id=communication_commitments.source_message_id), source_run_id=(SELECT MIN(r.id) FROM communication_classification_runs r WHERE r.tenant_id=communication_commitments.tenant_id AND r.workspace_id=communication_commitments.workspace_id AND r.conversation_key=communication_commitments.conversation_key AND r.message_id=communication_commitments.source_message_id), input_hash=(SELECT MIN(r.input_hash) FROM communication_classification_runs r WHERE r.tenant_id=communication_commitments.tenant_id AND r.workspace_id=communication_commitments.workspace_id AND r.conversation_key=communication_commitments.conversation_key AND r.message_id=communication_commitments.source_message_id), legacy_scope_state='resolved' WHERE account_id IS NULL AND 1=(SELECT COUNT(DISTINCT r.account_id) FROM communication_classification_runs r WHERE r.tenant_id=communication_commitments.tenant_id AND r.workspace_id=communication_commitments.workspace_id AND r.conversation_key=communication_commitments.conversation_key AND r.message_id=communication_commitments.source_message_id) AND 1=(SELECT COUNT(*) FROM communication_classification_runs r WHERE r.tenant_id=communication_commitments.tenant_id AND r.workspace_id=communication_commitments.workspace_id AND r.conversation_key=communication_commitments.conversation_key AND r.message_id=communication_commitments.source_message_id);
INSERT OR IGNORE INTO communication_legacy_scope_quarantine(commitment_id,tenant_id,workspace_id,resolution_state,authoritative_run_id,resolved_account_id,reason_code) SELECT id,tenant_id,workspace_id,CASE WHEN account_id IS NULL THEN 'quarantined_read_only' ELSE 'safely_backfilled' END,source_run_id,account_id,CASE WHEN account_id IS NULL THEN 'legacy_account_scope_not_authoritatively_unique' ELSE 'authoritative_single_run_scope' END FROM communication_commitments;
UPDATE communication_commitments SET legacy_scope_state='quarantined_read_only' WHERE account_id IS NULL;

CREATE UNIQUE INDEX idx_commitment_one_active_business_key ON communication_commitments(tenant_id,workspace_id,account_id,business_key) WHERE state IN ('active','overdue');
CREATE UNIQUE INDEX idx_deadline_one_current ON communication_deadlines(commitment_id) WHERE state='current';
CREATE INDEX idx_fencing_rejections_job ON communication_fencing_rejections(job_id,created_at);

-- Each protected insert proves the current job lease/fencing generation in SQLite at write time.
CREATE TRIGGER classification_run_fence_insert BEFORE INSERT ON communication_classification_runs WHEN NEW.job_id IS NULL OR NEW.fencing_generation IS NULL OR NOT EXISTS (SELECT 1 FROM nexora_autonomy_jobs j WHERE j.id=NEW.job_id AND j.user_id=NEW.tenant_id AND j.job_type='CLASSIFY_THREAD_TO_MISSION' AND j.state='RUNNING' AND j.fencing_generation=NEW.fencing_generation AND datetime(j.lease_until)>CURRENT_TIMESTAMP AND CAST(json_extract(j.input_json,'$.workspace_id') AS INTEGER)=NEW.workspace_id AND CAST(json_extract(j.input_json,'$.message_id') AS INTEGER)=NEW.message_id) BEGIN SELECT RAISE(ABORT,'classification_fence_rejected'); END;
CREATE TRIGGER classification_layer_fence_insert BEFORE INSERT ON communication_layer_results WHEN NEW.job_id IS NULL OR NOT EXISTS (SELECT 1 FROM communication_classification_runs r JOIN nexora_autonomy_jobs j ON j.id=NEW.job_id WHERE r.id=NEW.run_id AND r.tenant_id=NEW.tenant_id AND r.workspace_id=NEW.workspace_id AND r.account_id=NEW.account_id AND r.message_id=NEW.message_id AND r.input_hash=NEW.input_hash AND r.job_id=NEW.job_id AND r.fencing_generation=NEW.fencing_generation AND j.state='RUNNING' AND j.fencing_generation=NEW.fencing_generation AND datetime(j.lease_until)>CURRENT_TIMESTAMP) BEGIN SELECT RAISE(ABORT,'classification_layer_fence_rejected'); END;
CREATE TRIGGER conversation_cas_auth_fence_insert BEFORE INSERT ON communication_conversation_cas_authorizations WHEN NOT EXISTS (SELECT 1 FROM nexora_autonomy_jobs j WHERE j.id=NEW.job_id AND j.user_id=NEW.tenant_id AND j.state='RUNNING' AND j.fencing_generation=NEW.fencing_generation AND datetime(j.lease_until)>CURRENT_TIMESTAMP AND CAST(json_extract(j.input_json,'$.workspace_id') AS INTEGER)=NEW.workspace_id) OR (NEW.expected_current_id IS NULL AND EXISTS(SELECT 1 FROM communication_conversation_states c WHERE c.tenant_id=NEW.tenant_id AND c.workspace_id=NEW.workspace_id AND c.account_id=NEW.account_id AND c.conversation_key=NEW.conversation_key AND c.state='current')) OR (NEW.expected_current_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM communication_conversation_states c WHERE c.id=NEW.expected_current_id AND c.version=NEW.expected_version AND c.state=NEW.expected_state AND c.tenant_id=NEW.tenant_id AND c.workspace_id=NEW.workspace_id AND c.account_id=NEW.account_id)) BEGIN SELECT RAISE(ABORT,'conversation_cas_authorization_rejected'); END;
CREATE TRIGGER conversation_fence_insert BEFORE INSERT ON communication_conversation_states WHEN NOT EXISTS(SELECT 1 FROM communication_conversation_cas_authorizations a JOIN nexora_autonomy_jobs j ON j.id=a.job_id WHERE a.id=NEW.id||':cas' AND a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id AND a.account_id=NEW.account_id AND a.conversation_key=NEW.conversation_key AND a.input_hash=NEW.input_hash AND a.message_set_digest=NEW.message_set_digest AND a.consumed_at IS NULL AND datetime(a.expires_at)>CURRENT_TIMESTAMP AND j.state='RUNNING' AND j.fencing_generation=NEW.fencing_generation AND datetime(j.lease_until)>CURRENT_TIMESTAMP) BEGIN SELECT RAISE(ABORT,'conversation_cas_fence_rejected'); END;
CREATE TRIGGER commitment_fence_insert BEFORE INSERT ON communication_commitments WHEN NEW.account_id IS NULL OR NEW.legacy_scope_state!='resolved' OR NOT EXISTS(SELECT 1 FROM communication_classification_runs r JOIN nexora_autonomy_jobs j ON j.id=NEW.job_id JOIN communication_conversation_states s ON s.tenant_id=NEW.tenant_id AND s.workspace_id=NEW.workspace_id AND s.account_id=NEW.account_id AND s.conversation_key=NEW.conversation_key AND s.state='current' WHERE r.id=NEW.source_run_id AND r.account_id=NEW.account_id AND r.message_id=NEW.source_message_id AND r.input_hash=NEW.input_hash AND j.state='RUNNING' AND j.fencing_generation=NEW.fencing_generation AND datetime(j.lease_until)>CURRENT_TIMESTAMP) BEGIN SELECT RAISE(ABORT,'commitment_fence_or_scope_rejected'); END;
CREATE TRIGGER verification_fence_insert BEFORE INSERT ON communication_commitment_verifications WHEN NOT EXISTS(SELECT 1 FROM communication_commitments c JOIN communication_classification_runs r ON r.id=NEW.classification_run_id JOIN nexora_autonomy_jobs j ON j.id=NEW.job_id WHERE c.id=NEW.commitment_id AND c.tenant_id=NEW.tenant_id AND c.workspace_id=NEW.workspace_id AND c.account_id=NEW.account_id AND c.version=NEW.commitment_version AND c.conversation_key=NEW.conversation_key AND c.committed_party_ref=NEW.committed_party_ref AND r.tenant_id=NEW.tenant_id AND r.workspace_id=NEW.workspace_id AND r.account_id=NEW.account_id AND r.conversation_key=NEW.conversation_key AND r.message_id=NEW.source_message_id AND r.input_hash=NEW.input_hash AND j.state='RUNNING' AND j.fencing_generation=NEW.fencing_generation AND datetime(j.lease_until)>CURRENT_TIMESTAMP) BEGIN SELECT RAISE(ABORT,'commitment_verification_fence_or_binding_rejected'); END;
CREATE TRIGGER deadline_fence_insert BEFORE INSERT ON communication_deadlines WHEN NOT EXISTS(SELECT 1 FROM communication_commitments c JOIN communication_commitment_verifications v ON v.id=NEW.verification_id JOIN nexora_autonomy_jobs j ON j.id=NEW.job_id WHERE c.id=NEW.commitment_id AND c.tenant_id=NEW.tenant_id AND c.workspace_id=NEW.workspace_id AND c.account_id=NEW.account_id AND c.version=NEW.commitment_version AND c.state NOT IN ('fulfilled','cancelled','superseded') AND v.commitment_id=c.id AND v.commitment_version=c.version AND v.source_message_id=NEW.source_message_id AND v.classification_run_id=NEW.classification_run_id AND v.input_hash=NEW.input_hash AND v.requested_transition='replace_deadline' AND v.state='verified' AND v.consumed_at IS NULL AND datetime(v.expires_at)>CURRENT_TIMESTAMP AND j.state='RUNNING' AND j.fencing_generation=NEW.fencing_generation AND datetime(j.lease_until)>CURRENT_TIMESTAMP) BEGIN SELECT RAISE(ABORT,'deadline_fence_verification_or_terminal_rejected'); END;
CREATE TRIGGER checkpoint_fence_insert BEFORE INSERT ON communication_job_checkpoints WHEN NOT EXISTS(SELECT 1 FROM nexora_autonomy_jobs j WHERE j.id=NEW.job_id AND j.user_id=NEW.tenant_id AND j.state='RUNNING' AND j.fencing_generation=NEW.fencing_generation AND datetime(j.lease_until)>CURRENT_TIMESTAMP AND CAST(json_extract(j.input_json,'$.workspace_id') AS INTEGER)=NEW.workspace_id AND CAST(json_extract(j.input_json,'$.message_id') AS INTEGER)=NEW.message_id) BEGIN SELECT RAISE(ABORT,'classification_checkpoint_fence_rejected'); END;
CREATE TRIGGER commitment_event_fence_insert BEFORE INSERT ON communication_commitment_events WHEN NEW.job_id IS NULL OR NOT EXISTS(SELECT 1 FROM communication_commitments c JOIN nexora_autonomy_jobs j ON j.id=NEW.job_id WHERE c.id=NEW.commitment_id AND c.tenant_id=NEW.tenant_id AND c.workspace_id=NEW.workspace_id AND c.account_id=NEW.account_id AND c.version=NEW.commitment_version AND j.state='RUNNING' AND j.fencing_generation=NEW.fencing_generation AND datetime(j.lease_until)>CURRENT_TIMESTAMP) BEGIN SELECT RAISE(ABORT,'commitment_event_fence_rejected'); END;
CREATE TRIGGER layer_no_update BEFORE UPDATE ON communication_layer_results BEGIN SELECT RAISE(ABORT,'classification_history_append_only'); END;
CREATE TRIGGER layer_no_delete BEFORE DELETE ON communication_layer_results BEGIN SELECT RAISE(ABORT,'classification_history_append_only'); END;
CREATE TRIGGER deadline_no_delete BEFORE DELETE ON communication_deadlines BEGIN SELECT RAISE(ABORT,'deadline_history_append_only'); END;
CREATE TRIGGER checkpoint_no_update BEFORE UPDATE ON communication_job_checkpoints BEGIN SELECT RAISE(ABORT,'checkpoint_append_only'); END;
CREATE TRIGGER checkpoint_no_delete BEFORE DELETE ON communication_job_checkpoints BEGIN SELECT RAISE(ABORT,'checkpoint_append_only'); END;

-- The authorization must protect both sides of a conversation CAS, not only the insertion of its replacement.
CREATE TRIGGER conversation_supersede_fence BEFORE UPDATE OF state ON communication_conversation_states
WHEN NEW.state='superseded' AND NOT EXISTS (SELECT 1 FROM communication_conversation_cas_authorizations a JOIN nexora_autonomy_jobs j ON j.id=a.job_id WHERE a.expected_current_id=OLD.id AND a.expected_version=OLD.version AND a.expected_state=OLD.state AND a.tenant_id=OLD.tenant_id AND a.workspace_id=OLD.workspace_id AND a.account_id=OLD.account_id AND a.conversation_key=OLD.conversation_key AND a.consumed_at IS NULL AND datetime(a.expires_at)>CURRENT_TIMESTAMP AND j.state='RUNNING' AND j.fencing_generation=a.fencing_generation AND datetime(j.lease_until)>CURRENT_TIMESTAMP)
BEGIN SELECT RAISE(ABORT,'conversation_supersession_cas_rejected'); END;

CREATE TRIGGER verification_consumption_guard BEFORE UPDATE ON communication_commitment_verifications
WHEN OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL OR NEW.id IS NOT OLD.id OR NEW.commitment_id IS NOT OLD.commitment_id OR NEW.commitment_version IS NOT OLD.commitment_version OR NEW.source_message_id IS NOT OLD.source_message_id OR NEW.classification_run_id IS NOT OLD.classification_run_id OR NEW.input_hash IS NOT OLD.input_hash OR NEW.committed_party_ref IS NOT OLD.committed_party_ref OR NEW.requested_transition IS NOT OLD.requested_transition OR NEW.evidence_set_hash IS NOT OLD.evidence_set_hash OR NEW.state IS NOT OLD.state OR NEW.authority_generation_state IS NOT OLD.authority_generation_state OR NEW.authority_generation IS NOT OLD.authority_generation
BEGIN SELECT RAISE(ABORT,'commitment_verification_append_only'); END;
CREATE TRIGGER verification_no_delete BEFORE DELETE ON communication_commitment_verifications BEGIN SELECT RAISE(ABORT,'commitment_verification_append_only'); END;
CREATE TRIGGER transition_authorization_no_delete BEFORE DELETE ON communication_transition_authorizations BEGIN SELECT RAISE(ABORT,'transition_authorization_history'); END;
CREATE TRIGGER commitment_state_guard BEFORE UPDATE OF state ON communication_commitments
WHEN NEW.version!=OLD.version+1 OR NOT EXISTS (SELECT 1 FROM communication_transition_authorizations a JOIN communication_commitment_verifications v ON v.id=a.verification_id JOIN nexora_autonomy_jobs j ON j.id=a.job_id WHERE a.commitment_id=OLD.id AND a.tenant_id=OLD.tenant_id AND a.workspace_id=OLD.workspace_id AND a.account_id=OLD.account_id AND a.from_state=OLD.state AND a.to_state=NEW.state AND a.expected_version=OLD.version AND a.committed_party_ref=OLD.committed_party_ref AND a.consumed_at IS NULL AND datetime(a.expires_at)>CURRENT_TIMESTAMP AND v.commitment_id=OLD.id AND v.commitment_version=OLD.version AND v.requested_transition=NEW.state AND v.input_hash=a.input_hash AND v.source_message_id=a.source_message_id AND v.classification_run_id=a.classification_run_id AND v.committed_party_ref=OLD.committed_party_ref AND v.state='verified' AND v.consumed_at IS NULL AND datetime(v.expires_at)>CURRENT_TIMESTAMP AND j.state='RUNNING' AND j.fencing_generation=a.fencing_generation AND datetime(j.lease_until)>CURRENT_TIMESTAMP)
BEGIN SELECT RAISE(ABORT,'commitment_state_requires_bound_verification'); END;
CREATE TRIGGER commitment_scope_immutable BEFORE UPDATE OF tenant_id,workspace_id,account_id,conversation_key,source_message_id,source_run_id,input_hash,committed_party_ref ON communication_commitments BEGIN SELECT RAISE(ABORT,'commitment_scope_immutable'); END;
CREATE TRIGGER event_no_update BEFORE UPDATE ON communication_commitment_events BEGIN SELECT RAISE(ABORT,'commitment_history_append_only'); END;
CREATE TRIGGER event_no_delete BEFORE DELETE ON communication_commitment_events BEGIN SELECT RAISE(ABORT,'commitment_history_append_only'); END;

CREATE TRIGGER deadline_update_guard BEFORE UPDATE OF state ON communication_deadlines
WHEN NEW.state NOT IN ('superseded','cancelled') OR OLD.state!='current' OR NOT EXISTS (SELECT 1 FROM nexora_autonomy_jobs j WHERE j.id=NEW.job_id AND j.state='RUNNING' AND j.fencing_generation=NEW.fencing_generation AND datetime(j.lease_until)>CURRENT_TIMESTAMP)
BEGIN SELECT RAISE(ABORT,'deadline_atomic_update_rejected'); END;
CREATE TRIGGER release_evaluation_no_update BEFORE UPDATE ON communication_release_evaluations BEGIN SELECT RAISE(ABORT,'release_evaluation_append_only'); END;
CREATE TRIGGER release_evaluation_no_delete BEFORE DELETE ON communication_release_evaluations BEGIN SELECT RAISE(ABORT,'release_evaluation_append_only'); END;

-- The caller cannot choose a smaller message set than the authoritative completed runs.
CREATE TRIGGER conversation_cas_message_set_guard BEFORE INSERT ON communication_conversation_cas_authorizations
WHEN NEW.message_set_json!=(SELECT json_group_array(json_object('message_id',message_id,'input_hash',input_hash)) FROM (SELECT message_id,input_hash FROM communication_classification_runs WHERE tenant_id=NEW.tenant_id AND workspace_id=NEW.workspace_id AND account_id=NEW.account_id AND conversation_key=NEW.conversation_key AND state='completed' ORDER BY message_id,input_hash))
BEGIN SELECT RAISE(ABORT,'conversation_message_set_not_authoritative'); END;
CREATE TRIGGER conversation_insert_job_binding_guard BEFORE INSERT ON communication_conversation_states
WHEN NOT EXISTS (SELECT 1 FROM communication_conversation_cas_authorizations a WHERE a.id=NEW.id||':cas' AND a.job_id=NEW.job_id AND a.fencing_generation=NEW.fencing_generation)
BEGIN SELECT RAISE(ABORT,'conversation_cas_job_binding_rejected'); END;

CREATE TRIGGER candidate_fence_insert BEFORE INSERT ON communication_mission_candidates
WHEN NEW.account_id IS NULL OR NOT EXISTS (SELECT 1 FROM communication_conversation_states cs JOIN nexora_autonomy_jobs j ON j.id=NEW.job_id WHERE cs.tenant_id=NEW.tenant_id AND cs.workspace_id=NEW.workspace_id AND cs.account_id=NEW.account_id AND cs.conversation_key=NEW.conversation_key AND cs.version=NEW.conversation_version AND cs.input_hash=NEW.input_hash AND j.state='RUNNING' AND j.fencing_generation=NEW.fencing_generation AND datetime(j.lease_until)>CURRENT_TIMESTAMP)
BEGIN SELECT RAISE(ABORT,'mission_candidate_fence_or_scope_rejected'); END;
CREATE TRIGGER thread_mission_fence_insert BEFORE INSERT ON mission_runtime_missions
WHEN NEW.kind='THREAD_TO_MISSION' AND (NEW.classification_job_id IS NULL OR NOT EXISTS (SELECT 1 FROM nexora_autonomy_jobs j WHERE j.id=NEW.classification_job_id AND j.user_id=NEW.tenant_id AND j.state='RUNNING' AND j.fencing_generation=NEW.classification_fencing_generation AND datetime(j.lease_until)>CURRENT_TIMESTAMP AND NEW.classification_input_hash IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'durable_mission_classification_fence_rejected'); END;
CREATE TRIGGER classification_evidence_fence_insert BEFORE INSERT ON mission_runtime_evidence
WHEN NEW.source_type='layered_classification' AND (NEW.classification_job_id IS NULL OR NOT EXISTS (SELECT 1 FROM nexora_autonomy_jobs j WHERE j.id=NEW.classification_job_id AND j.user_id=NEW.tenant_id AND j.state='RUNNING' AND j.fencing_generation=NEW.classification_fencing_generation AND datetime(j.lease_until)>CURRENT_TIMESTAMP AND NEW.classification_input_hash IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'classification_evidence_fence_rejected'); END;
CREATE TRIGGER classification_verification_fence_insert BEFORE INSERT ON mission_runtime_verifications
WHEN NEW.verifier='deterministic_thread_guard' AND (NEW.classification_job_id IS NULL OR NOT EXISTS (SELECT 1 FROM nexora_autonomy_jobs j WHERE j.id=NEW.classification_job_id AND j.user_id=NEW.tenant_id AND j.state='RUNNING' AND j.fencing_generation=NEW.classification_fencing_generation AND datetime(j.lease_until)>CURRENT_TIMESTAMP AND NEW.classification_input_hash IS NOT NULL))
BEGIN SELECT RAISE(ABORT,'classification_verification_fence_rejected'); END;
