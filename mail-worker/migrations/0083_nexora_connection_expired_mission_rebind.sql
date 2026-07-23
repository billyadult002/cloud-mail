-- Permit exactly one fenced replacement of an expired onboarding Mission while
-- the Connection is still credential-free/provider-free DISCOVERED.
DROP TRIGGER IF EXISTS trg_nexora_connection_mission_association_guarded;

CREATE TRIGGER trg_nexora_connection_mission_association_guarded
BEFORE UPDATE OF onboarding_mission_id ON nexora_connections
WHEN COALESCE(NEW.onboarding_mission_id,'')<>COALESCE(OLD.onboarding_mission_id,'') AND NOT (
 (OLD.state='DISCOVERED' AND NEW.state='AUTHORIZATION_PENDING' AND OLD.onboarding_mission_id IS NULL AND NEW.onboarding_mission_id IS NOT NULL) OR
 (
  OLD.state='DISCOVERED' AND NEW.state='AUTHORIZATION_PENDING'
  AND OLD.onboarding_mission_id IS NOT NULL AND NEW.onboarding_mission_id IS NOT NULL
  AND OLD.provider_connection_id IS NULL AND OLD.provider_connection_generation=0
  AND OLD.credential_reference_id IS NULL AND OLD.credential_generation=0
  AND EXISTS (
   SELECT 1 FROM nexora_onboarding_authorization_sessions old_session
   WHERE old_session.onboarding_mission_id=OLD.onboarding_mission_id
    AND old_session.tenant_id=OLD.tenant_id AND old_session.workspace_id=OLD.workspace_id
    AND old_session.provider=OLD.provider AND old_session.status='pending'
    AND julianday(old_session.expires_at) IS NOT NULL
    AND julianday(old_session.expires_at)<=julianday('now')
  )
  AND NOT EXISTS (
   SELECT 1 FROM nexora_onboarding_authorization_sessions old_session
   WHERE old_session.onboarding_mission_id=OLD.onboarding_mission_id
    AND old_session.tenant_id=OLD.tenant_id AND old_session.workspace_id=OLD.workspace_id
    AND old_session.provider=OLD.provider AND old_session.status='pending'
    AND (julianday(old_session.expires_at) IS NULL OR julianday(old_session.expires_at)>julianday('now'))
  )
  AND EXISTS (
   SELECT 1 FROM nexora_onboarding_authorization_sessions replacement_session
   JOIN nexora_connection_operations replacement_operation
    ON replacement_operation.authorization_session_id=replacement_session.id
    AND replacement_operation.connection_id=NEW.id
    AND replacement_operation.tenant_id=NEW.tenant_id
    AND replacement_operation.workspace_id=NEW.workspace_id
    AND replacement_operation.operation_type='REAUTHORIZE'
    AND replacement_operation.state='VERIFIED'
   JOIN nexora_connection_events replacement_event
    ON replacement_event.id=NEW.last_transition_event_id
    AND replacement_event.operation_id=replacement_operation.id
    AND replacement_event.connection_id=NEW.id
    AND replacement_event.tenant_id=NEW.tenant_id
    AND replacement_event.workspace_id=NEW.workspace_id
   WHERE replacement_session.onboarding_mission_id=NEW.onboarding_mission_id
    AND replacement_session.tenant_id=NEW.tenant_id AND replacement_session.workspace_id=NEW.workspace_id
    AND replacement_session.provider=NEW.provider AND replacement_session.status='pending'
    AND julianday(replacement_session.expires_at)>julianday('now')
  )
 ) OR
 (OLD.state='REAUTHORIZATION_REQUIRED' AND NEW.state='AUTHORIZATION_PENDING' AND OLD.onboarding_mission_id IS NOT NULL AND NEW.onboarding_mission_id IS NOT NULL)
)
BEGIN SELECT RAISE(ABORT,'nexora_connection_mission_association_invalid'); END;
