-- Align UCS provenance with the durable Mission Runtime evidence vocabulary.
DROP TRIGGER IF EXISTS conversation_mission_outcome_guard;
CREATE TRIGGER conversation_mission_outcome_guard BEFORE INSERT ON conversation_mission_provenance
WHEN NEW.verification_state='verified' AND (
 NEW.outcome_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM mission_runtime_outcomes o
  JOIN mission_runtime_verifications v ON v.id=o.verification_id AND v.mission_id=o.mission_id
  JOIN mission_runtime_evidence e ON e.id=v.evidence_id AND e.mission_id=o.mission_id
  WHERE o.id=NEW.outcome_id AND o.mission_id=NEW.mission_id
    AND o.tenant_id=NEW.tenant_id AND o.workspace_id=NEW.workspace_id
    AND o.state='verified' AND v.state='verified' AND e.status='supported'
 )
)
BEGIN SELECT RAISE(ABORT,'conversation_mission_verified_outcome_required'); END;

CREATE TRIGGER IF NOT EXISTS ucs_canonical_state_insert_outbox AFTER INSERT ON mail_canonical_state
BEGIN
 INSERT OR IGNORE INTO conversation_ingest_outbox(id,tenant_id,workspace_id,account_id,source_message_id,source_version,event_type)
 VALUES('ucs-canonical:'||NEW.tenant_id||':'||NEW.workspace_id||':'||NEW.message_id||':'||NEW.state_version,
        NEW.tenant_id,NEW.workspace_id,NEW.account_id,NEW.message_id,'canonical:'||NEW.state_version,'updated');
END;

CREATE TRIGGER IF NOT EXISTS ucs_canonical_state_update_outbox AFTER UPDATE OF state_version ON mail_canonical_state
WHEN NEW.state_version!=OLD.state_version
BEGIN
 INSERT OR IGNORE INTO conversation_ingest_outbox(id,tenant_id,workspace_id,account_id,source_message_id,source_version,event_type)
 VALUES('ucs-canonical:'||NEW.tenant_id||':'||NEW.workspace_id||':'||NEW.message_id||':'||NEW.state_version,
        NEW.tenant_id,NEW.workspace_id,NEW.account_id,NEW.message_id,'canonical:'||NEW.state_version,'updated');
END;
