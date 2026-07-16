-- UCS projection membership is deliberately separate from Facet Category.
-- These keys are portable conversation-state memberships materialized from
-- canonical state and normalized attachment evidence; they are never provider
-- labels, folders, or client-side inference.
ALTER TABLE conversation_projections
  ADD COLUMN membership_keys_json TEXT NOT NULL DEFAULT '[]';

DROP TRIGGER IF EXISTS conversation_projection_immutable_content;
CREATE TRIGGER conversation_projection_immutable_content BEFORE UPDATE OF tenant_id,workspace_id,conversation_id,projection_version,aggregate_version,materializer_version,title,preview,last_observed_at,message_count,unread_count,has_attachments,membership_keys_json,category_keys_json,facet_summary_json,active_commitment_ids_json,commitment_states_json,action_required,waiting_for_me,waiting_for_others,mission_ids_json,ranking_score,risk_key,canonical_folder_key,source_navigation_json,search_document,integrity_hash,materialization_checkpoint_id,materialization_generation,created_at ON conversation_projections BEGIN SELECT RAISE(ABORT,'conversation_projection_content_immutable'); END;

CREATE INDEX IF NOT EXISTS idx_conversation_projection_membership
  ON conversation_projections(tenant_id,workspace_id,state,last_observed_at);
