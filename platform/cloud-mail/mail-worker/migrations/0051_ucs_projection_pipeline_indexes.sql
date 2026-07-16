-- Keep aggregate folding and evidence-bound workflow lookups sublinear as the
-- resumable UCS backfill grows. These access paths are used for every message.
CREATE INDEX IF NOT EXISTS idx_ucs_messages_conversation
 ON conversation_messages(tenant_id,workspace_id,conversation_id,lifecycle_state,observed_at,source_message_id);

CREATE INDEX IF NOT EXISTS idx_ucs_messages_source
 ON conversation_messages(tenant_id,workspace_id,source_message_id,lifecycle_state);

CREATE INDEX IF NOT EXISTS idx_ucs_commitment_heads_conversation
 ON conversation_commitment_heads(tenant_id,workspace_id,conversation_id,current_commitment_id);

CREATE INDEX IF NOT EXISTS idx_ucs_evidence_source
 ON conversation_evidence(tenant_id,workspace_id,source_message_id,source_version,verification_state);
