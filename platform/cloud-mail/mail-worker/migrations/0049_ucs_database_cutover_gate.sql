-- Database-enforced UCS rollout gate. Rollback to zero is always permitted.
CREATE TRIGGER IF NOT EXISTS ucs_projection_cutover_gate
BEFORE UPDATE OF projection_read_enabled,rollout_percent ON conversation_cutover_state
WHEN NEW.projection_read_enabled=1 AND (
 NEW.rollout_percent NOT IN (1,10,25,50,100)
 OR NOT EXISTS (
  SELECT 1 FROM conversation_materialization_checkpoints cp
  WHERE cp.tenant_id=NEW.tenant_id AND cp.workspace_id=NEW.workspace_id
    AND cp.pipeline_key='ucs-backfill-v1' AND cp.state='ready'
    AND (SELECT COUNT(DISTINCT p.surface_key) FROM conversation_projection_parity p
         WHERE p.tenant_id=NEW.tenant_id AND p.workspace_id=NEW.workspace_id
           AND p.cutover_epoch=NEW.cutover_epoch AND p.high_watermark=cp.high_watermark
           AND p.materializer_version='ucs-materializer-v1' AND p.passed=1
           AND p.audit_run_id=(SELECT audit_run_id FROM conversation_projection_parity
                               WHERE tenant_id=NEW.tenant_id AND workspace_id=NEW.workspace_id
                                 AND cutover_epoch=NEW.cutover_epoch AND high_watermark=cp.high_watermark
                               ORDER BY observed_at DESC LIMIT 1))=6
 )
 OR EXISTS (SELECT 1 FROM conversation_pipeline_failures f WHERE f.tenant_id=NEW.tenant_id AND f.workspace_id=NEW.workspace_id AND f.resolved_at IS NULL)
 OR EXISTS (SELECT 1 FROM conversation_ingest_outbox o WHERE o.tenant_id=NEW.tenant_id AND o.workspace_id=NEW.workspace_id AND o.state!='processed')
 OR EXISTS (
  SELECT 1 FROM conversation_commitment_heads h JOIN conversation_commitments c ON c.id=h.current_commitment_id
  WHERE h.tenant_id=NEW.tenant_id AND h.workspace_id=NEW.workspace_id
    AND c.verification_state='verified' AND NOT EXISTS (
     SELECT 1 FROM json_each(c.evidence_ids_json) j JOIN conversation_evidence e ON e.id=j.value
     WHERE e.tenant_id=c.tenant_id AND e.workspace_id=c.workspace_id AND e.verification_state='verified'
    )
 )
 OR EXISTS (
  SELECT 1 FROM communication_mission_candidates mc
  JOIN mission_runtime_outcomes o ON o.mission_id=mc.mission_id AND o.tenant_id=mc.tenant_id AND o.workspace_id=mc.workspace_id AND o.state='verified'
  WHERE mc.tenant_id=NEW.tenant_id AND mc.workspace_id=NEW.workspace_id
    AND NOT EXISTS (SELECT 1 FROM conversation_mission_provenance p WHERE p.tenant_id=mc.tenant_id AND p.workspace_id=mc.workspace_id AND p.mission_id=mc.mission_id AND p.outcome_id=o.id AND p.verification_state='verified')
 )
)
BEGIN SELECT RAISE(ABORT,'ucs_projection_cutover_gates_not_satisfied'); END;

CREATE TRIGGER IF NOT EXISTS ucs_rollout_sequence_gate
BEFORE UPDATE OF rollout_percent ON conversation_cutover_state
WHEN NEW.rollout_percent>OLD.rollout_percent AND NOT (
 (OLD.rollout_percent=0 AND NEW.rollout_percent=1) OR
 (OLD.rollout_percent=1 AND NEW.rollout_percent=10) OR
 (OLD.rollout_percent=10 AND NEW.rollout_percent=25) OR
 (OLD.rollout_percent=25 AND NEW.rollout_percent=50) OR
 (OLD.rollout_percent=50 AND NEW.rollout_percent=100)
)
BEGIN SELECT RAISE(ABORT,'ucs_rollout_sequence_rejected'); END;
