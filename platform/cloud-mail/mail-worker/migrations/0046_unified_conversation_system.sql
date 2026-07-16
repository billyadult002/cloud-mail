-- NEXORA Unified Conversation System foundation.
-- Additive only: provider ledgers and 0042/0043 remain compatibility inputs.

CREATE TABLE IF NOT EXISTS conversation_aggregates (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 aggregate_version INTEGER NOT NULL DEFAULT 1,
 lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN ('active','merged','split','tombstoned')),
 subject_digest TEXT,
 participant_set_digest TEXT NOT NULL,
 message_set_digest TEXT NOT NULL,
 last_observed_at TEXT,
 superseded_by_id TEXT,
 integrity_hash TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,id)
);

CREATE TABLE IF NOT EXISTS conversation_source_bindings (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 conversation_id TEXT NOT NULL,
 provider_key TEXT NOT NULL,
 account_id INTEGER NOT NULL,
 provider_conversation_ref_hash TEXT NOT NULL,
 binding_state TEXT NOT NULL CHECK(binding_state IN ('active','superseded','tombstoned')),
 observed_at TEXT NOT NULL,
 evidence_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,provider_key,account_id,provider_conversation_ref_hash)
);

CREATE TABLE IF NOT EXISTS conversation_messages (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 conversation_id TEXT NOT NULL,
 provider_key TEXT NOT NULL,
 account_id INTEGER NOT NULL,
 source_message_id INTEGER,
 provider_message_ref_hash TEXT NOT NULL,
 direction TEXT NOT NULL CHECK(direction IN ('inbound','outbound','system','unknown')),
 observed_at TEXT NOT NULL,
 source_version TEXT,
 evidence_id TEXT,
 integrity_hash TEXT NOT NULL,
 lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN ('observed','updated','tombstoned','quarantined')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,provider_key,account_id,provider_message_ref_hash,source_version)
);

CREATE TABLE IF NOT EXISTS conversation_participants (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 conversation_id TEXT NOT NULL,
 identity_ref_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('sender','recipient','cc','bcc','workspace_actor','external','unknown')),
 first_observed_at TEXT NOT NULL,
 last_observed_at TEXT NOT NULL,
 evidence_id TEXT,
 UNIQUE(tenant_id,workspace_id,conversation_id,identity_ref_hash,role)
);

CREATE TABLE IF NOT EXISTS conversation_facet_results (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 conversation_id TEXT NOT NULL,
 dimension_key TEXT NOT NULL,
 value_key TEXT NOT NULL,
 result_version INTEGER NOT NULL,
 classifier_key TEXT NOT NULL,
 classifier_version TEXT NOT NULL,
 input_digest TEXT NOT NULL,
 confidence REAL NOT NULL CHECK(confidence>=0 AND confidence<=1),
 status TEXT NOT NULL CHECK(status IN ('candidate','supported','rejected','superseded','abstained')),
 explanation_code TEXT NOT NULL,
 evidence_ids_json TEXT NOT NULL,
 evidence_set_hash TEXT NOT NULL,
 supersedes_id TEXT,
 observed_at TEXT NOT NULL,
 expires_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,conversation_id,dimension_key,value_key,result_version)
);

CREATE TABLE IF NOT EXISTS conversation_facet_heads (
 tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, conversation_id TEXT NOT NULL,
 dimension_key TEXT NOT NULL, value_key TEXT NOT NULL, current_result_id TEXT NOT NULL,
 current_result_version INTEGER NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,workspace_id,conversation_id,dimension_key,value_key)
);

CREATE TABLE IF NOT EXISTS conversation_commitments (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 conversation_id TEXT NOT NULL,
 commitment_version INTEGER NOT NULL DEFAULT 1,
 business_key TEXT NOT NULL,
 owner_identity_ref_hash TEXT NOT NULL,
 beneficiary_identity_ref_hash TEXT,
 obligation_digest TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('WaitingForMe','WaitingForOthers','Resolved','Delegated','Scheduled','Blocked','Cancelled')),
 scheduled_for TEXT,
 delegated_to_identity_ref_hash TEXT,
 blocked_reason_code TEXT,
 source_classification_run_id TEXT,
 evidence_ids_json TEXT NOT NULL,
 evidence_set_hash TEXT NOT NULL,
 verification_state TEXT NOT NULL CHECK(verification_state IN ('verified','inconclusive','rejected')),
 supersedes_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,business_key,commitment_version)
);

CREATE TABLE IF NOT EXISTS conversation_commitment_heads (
 tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, conversation_id TEXT NOT NULL,
 business_key TEXT NOT NULL, current_commitment_id TEXT NOT NULL, current_commitment_version INTEGER NOT NULL,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,workspace_id,business_key)
);

CREATE TABLE IF NOT EXISTS conversation_commitment_events (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 conversation_id TEXT NOT NULL,
 commitment_id TEXT NOT NULL,
 commitment_version INTEGER NOT NULL,
 event_type TEXT NOT NULL,
 from_state TEXT,
 to_state TEXT NOT NULL,
 actor_ref_hash TEXT NOT NULL,
 evidence_ids_json TEXT NOT NULL,
 evidence_set_hash TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,idempotency_key)
);

CREATE TABLE IF NOT EXISTS conversation_projections (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 conversation_id TEXT NOT NULL,
 projection_version INTEGER NOT NULL,
 aggregate_version INTEGER NOT NULL,
 materializer_version TEXT NOT NULL,
 title TEXT NOT NULL,
 preview TEXT NOT NULL,
 last_observed_at TEXT,
 message_count INTEGER NOT NULL,
 unread_count INTEGER NOT NULL,
 has_attachments INTEGER NOT NULL,
 category_keys_json TEXT NOT NULL,
 facet_summary_json TEXT NOT NULL,
 active_commitment_ids_json TEXT NOT NULL,
 commitment_states_json TEXT NOT NULL,
 action_required INTEGER NOT NULL,
 waiting_for_me INTEGER NOT NULL,
 waiting_for_others INTEGER NOT NULL,
 mission_ids_json TEXT NOT NULL,
 ranking_score REAL NOT NULL DEFAULT 0,
 risk_key TEXT NOT NULL DEFAULT 'unknown',
 canonical_folder_key TEXT NOT NULL DEFAULT 'inbox',
 source_navigation_json TEXT NOT NULL,
 search_document TEXT NOT NULL,
 integrity_hash TEXT NOT NULL,
 materialization_checkpoint_id TEXT NOT NULL,
 materialization_generation INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('current','superseded','quarantined')),
 supersedes_id TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,conversation_id,projection_version)
);

CREATE TABLE IF NOT EXISTS conversation_materialization_checkpoints (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 pipeline_key TEXT NOT NULL,
 cursor_json TEXT NOT NULL,
 high_watermark TEXT,
 last_projection_id TEXT,
 processed_count INTEGER NOT NULL DEFAULT 0,
 quarantined_count INTEGER NOT NULL DEFAULT 0,
 state TEXT NOT NULL CHECK(state IN ('running','ready','paused','failed')),
 lease_owner TEXT,
 lease_generation INTEGER NOT NULL DEFAULT 0,
 lease_until TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,pipeline_key)
);

CREATE TABLE IF NOT EXISTS conversation_pipeline_failures (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 pipeline_key TEXT NOT NULL,
 source_ref TEXT NOT NULL,
 source_ref_hash TEXT NOT NULL,
 stage TEXT NOT NULL,
 reason_code TEXT NOT NULL,
 retryable INTEGER NOT NULL,
 attempt_count INTEGER NOT NULL DEFAULT 1,
 next_attempt_at TEXT,
 resolved_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversation_projection_parity (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 surface_key TEXT NOT NULL,
 legacy_count INTEGER NOT NULL,
 projection_count INTEGER NOT NULL,
 missing_ids_hash TEXT NOT NULL,
 extra_ids_hash TEXT NOT NULL,
 representative_rows_hash TEXT NOT NULL,
 high_watermark TEXT NOT NULL,
 materializer_version TEXT NOT NULL,
 cutover_epoch INTEGER NOT NULL,
 missing_count INTEGER NOT NULL,
 extra_count INTEGER NOT NULL,
 content_mismatch_count INTEGER NOT NULL,
 unexplained_count INTEGER NOT NULL,
 thresholds_json TEXT NOT NULL,
 passed INTEGER NOT NULL,
 observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,surface_key,cutover_epoch,high_watermark)
);

CREATE TABLE IF NOT EXISTS conversation_mission_provenance (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 mission_id TEXT NOT NULL,
 conversation_id TEXT NOT NULL,
 commitment_id TEXT NOT NULL,
 commitment_version INTEGER NOT NULL,
 projection_id TEXT NOT NULL,
 projection_version INTEGER NOT NULL,
 evidence_ids_json TEXT NOT NULL,
 evidence_set_hash TEXT NOT NULL,
 policy_version TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 verification_state TEXT NOT NULL CHECK(verification_state IN ('verified','rejected')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,idempotency_key),
 UNIQUE(tenant_id,workspace_id,mission_id)
);

CREATE TABLE IF NOT EXISTS conversation_cutover_state (
 workspace_id INTEGER PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 dual_write_enabled INTEGER NOT NULL DEFAULT 0,
 shadow_read_enabled INTEGER NOT NULL DEFAULT 0,
 projection_read_enabled INTEGER NOT NULL DEFAULT 0,
 cutover_epoch INTEGER NOT NULL DEFAULT 0,
 rollback_reason_code TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS conversation_facet_no_update BEFORE UPDATE ON conversation_facet_results BEGIN SELECT RAISE(ABORT,'conversation_facet_append_only'); END;
CREATE TRIGGER IF NOT EXISTS conversation_facet_no_delete BEFORE DELETE ON conversation_facet_results BEGIN SELECT RAISE(ABORT,'conversation_facet_append_only'); END;
CREATE TRIGGER IF NOT EXISTS conversation_commitment_event_no_update_v2 BEFORE UPDATE ON conversation_commitment_events BEGIN SELECT RAISE(ABORT,'conversation_commitment_history_append_only'); END;
CREATE TRIGGER IF NOT EXISTS conversation_commitment_event_no_delete_v2 BEFORE DELETE ON conversation_commitment_events BEGIN SELECT RAISE(ABORT,'conversation_commitment_history_append_only'); END;
CREATE TRIGGER IF NOT EXISTS conversation_projection_immutable_content BEFORE UPDATE OF tenant_id,workspace_id,conversation_id,projection_version,aggregate_version,materializer_version,title,preview,last_observed_at,message_count,unread_count,has_attachments,category_keys_json,facet_summary_json,active_commitment_ids_json,commitment_states_json,action_required,waiting_for_me,waiting_for_others,mission_ids_json,ranking_score,risk_key,canonical_folder_key,source_navigation_json,search_document,integrity_hash,materialization_checkpoint_id,materialization_generation,created_at ON conversation_projections BEGIN SELECT RAISE(ABORT,'conversation_projection_content_immutable'); END;
CREATE TRIGGER IF NOT EXISTS conversation_projection_state_guard BEFORE UPDATE OF state ON conversation_projections WHEN OLD.state!='current' OR NEW.state!='superseded' BEGIN SELECT RAISE(ABORT,'conversation_projection_state_transition_rejected'); END;
CREATE TRIGGER IF NOT EXISTS conversation_projection_no_delete BEFORE DELETE ON conversation_projections BEGIN SELECT RAISE(ABORT,'conversation_projection_append_only'); END;
CREATE TRIGGER IF NOT EXISTS conversation_mission_provenance_no_update BEFORE UPDATE ON conversation_mission_provenance BEGIN SELECT RAISE(ABORT,'conversation_mission_provenance_append_only'); END;
CREATE TRIGGER IF NOT EXISTS conversation_mission_provenance_no_delete BEFORE DELETE ON conversation_mission_provenance BEGIN SELECT RAISE(ABORT,'conversation_mission_provenance_append_only'); END;
CREATE TRIGGER IF NOT EXISTS conversation_binding_scope_guard BEFORE INSERT ON conversation_source_bindings WHEN NOT EXISTS(SELECT 1 FROM conversation_aggregates a WHERE a.id=NEW.conversation_id AND a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'conversation_binding_scope_rejected'); END;
CREATE TRIGGER IF NOT EXISTS conversation_message_scope_guard BEFORE INSERT ON conversation_messages WHEN NOT EXISTS(SELECT 1 FROM conversation_aggregates a WHERE a.id=NEW.conversation_id AND a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'conversation_message_scope_rejected'); END;
CREATE TRIGGER IF NOT EXISTS conversation_facet_scope_guard BEFORE INSERT ON conversation_facet_results WHEN NOT EXISTS(SELECT 1 FROM conversation_aggregates a WHERE a.id=NEW.conversation_id AND a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'conversation_facet_scope_rejected'); END;
CREATE TRIGGER IF NOT EXISTS conversation_commitment_scope_guard BEFORE INSERT ON conversation_commitments WHEN NOT EXISTS(SELECT 1 FROM conversation_aggregates a WHERE a.id=NEW.conversation_id AND a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id) BEGIN SELECT RAISE(ABORT,'conversation_commitment_scope_rejected'); END;
CREATE TRIGGER IF NOT EXISTS conversation_projection_scope_fence_guard BEFORE INSERT ON conversation_projections WHEN NOT EXISTS(SELECT 1 FROM conversation_aggregates a JOIN conversation_materialization_checkpoints cp ON cp.id=NEW.materialization_checkpoint_id WHERE a.id=NEW.conversation_id AND a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id AND cp.tenant_id=NEW.tenant_id AND cp.workspace_id=NEW.workspace_id AND cp.lease_generation=NEW.materialization_generation AND cp.state='running' AND datetime(cp.lease_until)>CURRENT_TIMESTAMP) BEGIN SELECT RAISE(ABORT,'conversation_projection_scope_or_fence_rejected'); END;
CREATE TRIGGER IF NOT EXISTS conversation_mission_provenance_scope_guard BEFORE INSERT ON conversation_mission_provenance WHEN NOT EXISTS(SELECT 1 FROM conversation_aggregates a JOIN conversation_commitments c ON c.id=NEW.commitment_id AND c.tenant_id=NEW.tenant_id AND c.workspace_id=NEW.workspace_id AND c.conversation_id=NEW.conversation_id AND c.commitment_version=NEW.commitment_version JOIN conversation_projections p ON p.id=NEW.projection_id AND p.tenant_id=NEW.tenant_id AND p.workspace_id=NEW.workspace_id AND p.conversation_id=NEW.conversation_id AND p.projection_version=NEW.projection_version WHERE a.id=NEW.conversation_id AND a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id AND c.verification_state='verified') BEGIN SELECT RAISE(ABORT,'conversation_mission_provenance_scope_rejected'); END;

CREATE UNIQUE INDEX IF NOT EXISTS idx_conversation_projection_current ON conversation_projections(tenant_id,workspace_id,conversation_id) WHERE state='current';
CREATE INDEX IF NOT EXISTS idx_conversation_projection_surface ON conversation_projections(tenant_id,workspace_id,state,last_observed_at);
CREATE INDEX IF NOT EXISTS idx_conversation_projection_action ON conversation_projections(tenant_id,workspace_id,state,action_required,waiting_for_me,waiting_for_others);
CREATE INDEX IF NOT EXISTS idx_conversation_facet_current ON conversation_facet_results(tenant_id,workspace_id,conversation_id,dimension_key,value_key,status);
CREATE INDEX IF NOT EXISTS idx_conversation_commitment_state ON conversation_commitments(tenant_id,workspace_id,state,updated_at);
CREATE INDEX IF NOT EXISTS idx_conversation_failure_retry ON conversation_pipeline_failures(tenant_id,workspace_id,pipeline_key,resolved_at,next_attempt_at);
