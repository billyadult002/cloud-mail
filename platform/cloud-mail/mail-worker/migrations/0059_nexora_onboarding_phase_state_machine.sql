-- Adds the onboarding-mission phase column: the 18-state Zero-Touch onboarding state
-- machine (Required Output #2 of the Zero-Touch OAuth Logic Completion mission), distinct
-- from the finer-grained discovery/authorization/approval/connection/capability/sync/
-- verification sub-state columns already added in 0058, which remain detail projections.
ALTER TABLE nexora_onboarding_state ADD COLUMN phase TEXT NOT NULL DEFAULT 'discovering'
 CHECK(phase IN (
  'discovering','provider_identified','authorization_path_selected',
  'waiting_for_user_login','waiting_for_user_consent','waiting_for_admin_consent','waiting_for_provider_review',
  'authorization_received','validating_authority','discovering_capabilities','provisioning',
  'verifying_connection','starting_initial_sync','verifying_initial_sync',
  'connected','degraded','blocked','failed','cancelled'
 ));
ALTER TABLE nexora_onboarding_state ADD COLUMN phase_version INTEGER NOT NULL DEFAULT 1;
CREATE INDEX IF NOT EXISTS idx_nexora_onboarding_state_phase ON nexora_onboarding_state(tenant_id,workspace_id,phase);
