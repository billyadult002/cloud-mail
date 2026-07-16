-- UCS authoritative cutover hardening. Additive and rollback-safe while reads remain shadow-only.

CREATE TABLE IF NOT EXISTS conversation_evidence (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 source_type TEXT NOT NULL, source_message_id INTEGER NOT NULL, source_version TEXT NOT NULL,
 content_digest TEXT NOT NULL, integrity_hash TEXT NOT NULL,
 verification_state TEXT NOT NULL CHECK(verification_state IN ('verified','rejected')),
 observed_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,source_message_id,source_version)
);

CREATE TABLE IF NOT EXISTS conversation_ingest_outbox (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 account_id INTEGER NOT NULL, source_message_id INTEGER NOT NULL, source_version TEXT NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type IN ('observed','updated')),
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','processing','processed','failed')),
 attempt_count INTEGER NOT NULL DEFAULT 0, lease_owner TEXT, lease_until TEXT,
 last_error_code TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 processed_at TEXT, UNIQUE(tenant_id,workspace_id,source_message_id,source_version,event_type)
);

CREATE TABLE IF NOT EXISTS conversation_facet_snapshots (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 conversation_id TEXT NOT NULL, generation INTEGER NOT NULL, input_digest TEXT NOT NULL,
 active_result_ids_json TEXT NOT NULL, evidence_ids_json TEXT NOT NULL,
 evidence_set_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,conversation_id,generation)
);

CREATE TABLE IF NOT EXISTS conversation_commitment_transition_authorizations (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 conversation_id TEXT NOT NULL, commitment_id TEXT NOT NULL, from_version INTEGER NOT NULL,
 to_state TEXT NOT NULL, evidence_id TEXT NOT NULL, evidence_integrity_hash TEXT NOT NULL,
 request_hash TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,request_hash)
);

CREATE TABLE IF NOT EXISTS conversation_rollout_observations (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 cutover_epoch INTEGER NOT NULL, rollout_percent INTEGER NOT NULL,
 eligible INTEGER NOT NULL, parity_passed INTEGER NOT NULL, unresolved_failures INTEGER NOT NULL,
 dual_write_lag_count INTEGER NOT NULL, reason_codes_json TEXT NOT NULL,
 observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS conversation_processing_receipts (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 source_message_id INTEGER NOT NULL, source_version TEXT NOT NULL,
 conversation_id TEXT NOT NULL, evidence_id TEXT NOT NULL, projection_id TEXT NOT NULL,
 processing_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,source_message_id,source_version)
);

ALTER TABLE conversation_aggregates ADD COLUMN facet_generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_cutover_state ADD COLUMN rollout_percent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversation_mission_provenance ADD COLUMN outcome_id TEXT;
ALTER TABLE conversation_projection_parity ADD COLUMN audit_run_id TEXT NOT NULL DEFAULT '';

CREATE TRIGGER IF NOT EXISTS ucs_email_observed_outbox AFTER INSERT ON email
BEGIN
 INSERT OR IGNORE INTO conversation_ingest_outbox(id,tenant_id,workspace_id,account_id,source_message_id,source_version,event_type)
 SELECT 'ucs-ingest:'||wb.subject_user_id||':'||wb.workspace_id||':'||NEW.email_id||':'||COALESCE(NEW.create_time,''),
        wb.subject_user_id,wb.workspace_id,NEW.account_id,NEW.email_id,COALESCE(NEW.create_time,''),'observed'
 FROM workspace_account_bindings wb
 WHERE wb.account_id=NEW.account_id AND wb.lifecycle_state='READY';
END;

CREATE TRIGGER IF NOT EXISTS ucs_email_updated_outbox AFTER UPDATE OF subject,content,text,unread,is_del,status ON email
BEGIN
 INSERT OR IGNORE INTO conversation_ingest_outbox(id,tenant_id,workspace_id,account_id,source_message_id,source_version,event_type)
 SELECT 'ucs-update:'||wb.subject_user_id||':'||wb.workspace_id||':'||NEW.email_id||':'||NEW.unread||':'||NEW.is_del||':'||NEW.status||':'||length(COALESCE(NEW.text,NEW.content,'')),
        wb.subject_user_id,wb.workspace_id,NEW.account_id,NEW.email_id,
        NEW.unread||':'||NEW.is_del||':'||NEW.status||':'||length(COALESCE(NEW.text,NEW.content,'')),'updated'
 FROM workspace_account_bindings wb
 WHERE wb.account_id=NEW.account_id AND wb.lifecycle_state='READY';
END;

CREATE TRIGGER IF NOT EXISTS conversation_evidence_no_update BEFORE UPDATE ON conversation_evidence
BEGIN SELECT RAISE(ABORT,'conversation_evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS conversation_evidence_no_delete BEFORE DELETE ON conversation_evidence
BEGIN SELECT RAISE(ABORT,'conversation_evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS conversation_facet_snapshot_no_update BEFORE UPDATE ON conversation_facet_snapshots
BEGIN SELECT RAISE(ABORT,'conversation_facet_snapshot_append_only'); END;
CREATE TRIGGER IF NOT EXISTS conversation_facet_snapshot_no_delete BEFORE DELETE ON conversation_facet_snapshots
BEGIN SELECT RAISE(ABORT,'conversation_facet_snapshot_append_only'); END;

CREATE TRIGGER IF NOT EXISTS conversation_commitment_verified_evidence_guard BEFORE INSERT ON conversation_commitments
WHEN NEW.verification_state='verified' AND NOT EXISTS (
 SELECT 1 FROM json_each(NEW.evidence_ids_json) j JOIN conversation_evidence e ON e.id=j.value
 WHERE e.tenant_id=NEW.tenant_id AND e.workspace_id=NEW.workspace_id
   AND e.verification_state='verified'
)
BEGIN SELECT RAISE(ABORT,'conversation_commitment_verified_evidence_required'); END;

CREATE TRIGGER IF NOT EXISTS conversation_commitment_transition_consumption_guard BEFORE INSERT ON conversation_commitment_events
WHEN NEW.event_type!='backfill_created' AND NOT EXISTS (
 SELECT 1 FROM conversation_commitment_transition_authorizations a
 WHERE a.tenant_id=NEW.tenant_id AND a.workspace_id=NEW.workspace_id
   AND a.conversation_id=NEW.conversation_id AND a.commitment_id=NEW.commitment_id
   AND a.from_version=NEW.commitment_version-1 AND a.to_state=NEW.to_state
   AND a.consumed_at IS NULL AND datetime(a.expires_at)>CURRENT_TIMESTAMP
)
BEGIN SELECT RAISE(ABORT,'conversation_commitment_transition_evidence_authorization_required'); END;

CREATE TRIGGER IF NOT EXISTS conversation_mission_outcome_guard BEFORE INSERT ON conversation_mission_provenance
WHEN NEW.verification_state='verified' AND (
 NEW.outcome_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM mission_runtime_outcomes o
  JOIN mission_runtime_verifications v ON v.id=o.verification_id AND v.mission_id=o.mission_id
  JOIN mission_runtime_evidence e ON e.id=v.evidence_id AND e.mission_id=o.mission_id
  WHERE o.id=NEW.outcome_id AND o.mission_id=NEW.mission_id
    AND o.tenant_id=NEW.tenant_id AND o.workspace_id=NEW.workspace_id
    AND o.state='verified' AND v.state='verified' AND e.status='verified'
 )
)
BEGIN SELECT RAISE(ABORT,'conversation_mission_verified_outcome_required'); END;

CREATE INDEX IF NOT EXISTS idx_ucs_ingest_pending ON conversation_ingest_outbox(state,lease_until,created_at);
CREATE INDEX IF NOT EXISTS idx_ucs_evidence_source ON conversation_evidence(tenant_id,workspace_id,source_message_id,source_version);
CREATE INDEX IF NOT EXISTS idx_ucs_rollout_epoch ON conversation_rollout_observations(tenant_id,workspace_id,cutover_epoch,rollout_percent);
CREATE INDEX IF NOT EXISTS idx_ucs_processing_receipt ON conversation_processing_receipts(tenant_id,workspace_id,source_message_id,source_version);
