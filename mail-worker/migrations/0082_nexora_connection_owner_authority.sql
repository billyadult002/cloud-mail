-- Canonical account owners have authority generation zero. Rebuild the three empty-or-preserved
-- Connection Runtime tables so the stored fence accepts that canonical value without synthesis.
-- The rebuild also permits a replacement Mission only as part of the verified
-- REAUTHORIZATION_REQUIRED -> AUTHORIZATION_PENDING transition.

DROP TRIGGER IF EXISTS trg_nexora_connection_initial_state;
DROP TRIGGER IF EXISTS trg_nexora_connection_binding_immutable;
DROP TRIGGER IF EXISTS trg_nexora_connection_mission_association_guarded;
DROP TRIGGER IF EXISTS trg_nexora_connection_legal_transition;
DROP TRIGGER IF EXISTS trg_nexora_connection_transition_authority;
DROP TRIGGER IF EXISTS trg_nexora_connection_authority_fields_guarded;
DROP TRIGGER IF EXISTS trg_nexora_connection_lease_session_guarded;
DROP TRIGGER IF EXISTS trg_nexora_connection_operation_authority_immutable;
DROP TRIGGER IF EXISTS trg_nexora_connection_operation_state_progression;
DROP TRIGGER IF EXISTS trg_nexora_connection_events_no_update;
DROP TRIGGER IF EXISTS trg_nexora_connection_events_no_delete;

CREATE TABLE nexora_connections_v2 (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 normalized_domain TEXT NOT NULL,
 domain_authority_id TEXT NOT NULL,
 domain_authority_generation INTEGER NOT NULL CHECK(domain_authority_generation>0),
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
 account_id INTEGER NOT NULL,
 onboarding_mission_id TEXT,
 provider_connection_id TEXT,
 provider_connection_generation INTEGER NOT NULL DEFAULT 0 CHECK(provider_connection_generation>=0),
 credential_reference_id TEXT,
 credential_generation INTEGER NOT NULL DEFAULT 0 CHECK(credential_generation>=0),
 state TEXT NOT NULL CHECK(state IN ('DISCOVERED','AUTHORIZATION_PENDING','CALLBACK_PENDING','CONNECTED','HEALTHY','REFRESH_PENDING','DEGRADED','RETRY_WAIT','REAUTHORIZATION_REQUIRED','SUSPENDED','REVOKED','DISCONNECTED','FAILED_TERMINAL')),
 authority_generation INTEGER NOT NULL CHECK(authority_generation>=0),
 connection_generation INTEGER NOT NULL DEFAULT 1 CHECK(connection_generation>0),
 provider_session_generation INTEGER NOT NULL DEFAULT 0 CHECK(provider_session_generation>=0),
 last_transition_event_id TEXT,
 last_verified_health_at TEXT,
 last_refresh_attempt_at TEXT,
 next_eligible_retry_at TEXT,
 consecutive_failure_count INTEGER NOT NULL DEFAULT 0 CHECK(consecutive_failure_count>=0),
 reauthorization_required INTEGER NOT NULL DEFAULT 0 CHECK(reauthorization_required IN (0,1)),
 suspended_at TEXT,
 revoked_at TEXT,
 lease_owner TEXT,
 lease_expires_at TEXT,
 fencing_token INTEGER NOT NULL DEFAULT 0 CHECK(fencing_token>=0),
 circuit_open_until TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,provider,account_id),
 UNIQUE(provider_connection_id),
 UNIQUE(credential_reference_id),
 UNIQUE(id,tenant_id,workspace_id),
 CHECK((lease_owner IS NULL AND lease_expires_at IS NULL) OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)),
 CHECK((state='REVOKED' AND revoked_at IS NOT NULL) OR (state<>'REVOKED' AND revoked_at IS NULL)),
 CHECK((state='SUSPENDED' AND suspended_at IS NOT NULL) OR (state<>'SUSPENDED' AND suspended_at IS NULL)),
 CHECK((credential_reference_id IS NULL AND credential_generation=0 AND provider_connection_id IS NULL AND provider_connection_generation=0) OR (credential_reference_id IS NOT NULL AND credential_generation>0 AND provider_connection_id IS NOT NULL AND provider_connection_generation>0))
);

CREATE TABLE nexora_connection_operations_v2 (
 id TEXT PRIMARY KEY,
 connection_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 operation_type TEXT NOT NULL CHECK(operation_type IN ('DISCOVER','CALLBACK','HEALTH','REFRESH','SUSPEND','REVOKE','REAUTHORIZE')),
 idempotency_key TEXT NOT NULL,
 authorization_session_id TEXT,
 callback_correlation_id TEXT,
 expected_authority_generation INTEGER NOT NULL CHECK(expected_authority_generation>=0),
 expected_connection_generation INTEGER NOT NULL CHECK(expected_connection_generation>0),
 expected_credential_generation INTEGER NOT NULL CHECK(expected_credential_generation>=0),
 lease_owner TEXT,
 lease_expires_at TEXT,
 fencing_token INTEGER,
 transition_from_state TEXT,
 transition_to_state TEXT,
 state TEXT NOT NULL CHECK(state IN ('PENDING','LEASED','PROVIDER_RESPONSE_OBSERVED','EVIDENCE_WRITTEN','VERIFIED','RETRY_WAIT','BLOCKED','FAILED')),
 request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
 authority_tuple_digest TEXT NOT NULL CHECK(length(authority_tuple_digest)=64),
 provider_response_classification TEXT,
 provider_http_status INTEGER,
 provider_network_called INTEGER NOT NULL DEFAULT 0 CHECK(provider_network_called IN (0,1)),
 mailbox_mutated INTEGER NOT NULL DEFAULT 0 CHECK(mailbox_mutated=0),
 response_digest TEXT CHECK(response_digest IS NULL OR length(response_digest)=64),
 evidence_id TEXT,
 verification_id TEXT,
 claim_id TEXT,
 error_code TEXT,
 attempt INTEGER NOT NULL DEFAULT 0 CHECK(attempt>=0),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(connection_id,operation_type,idempotency_key),
 UNIQUE(id,connection_id,tenant_id,workspace_id),
 FOREIGN KEY(connection_id,tenant_id,workspace_id) REFERENCES nexora_connections_v2(id,tenant_id,workspace_id),
 CHECK((lease_owner IS NULL AND lease_expires_at IS NULL AND fencing_token IS NULL) OR (lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL AND fencing_token IS NOT NULL)),
 CHECK((state='VERIFIED' AND evidence_id IS NOT NULL AND verification_id IS NOT NULL) OR state<>'VERIFIED')
);

CREATE TABLE nexora_connection_events_v2 (
 id TEXT PRIMARY KEY,
 connection_id TEXT NOT NULL,
 operation_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 event_type TEXT NOT NULL,
 from_state TEXT NOT NULL,
 to_state TEXT NOT NULL,
 connection_generation INTEGER NOT NULL CHECK(connection_generation>1),
 fencing_token INTEGER NOT NULL CHECK(fencing_token>0),
 detail_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(connection_id,connection_generation),
 UNIQUE(connection_id,event_type,operation_id),
 FOREIGN KEY(connection_id,tenant_id,workspace_id) REFERENCES nexora_connections_v2(id,tenant_id,workspace_id),
 FOREIGN KEY(operation_id,connection_id,tenant_id,workspace_id) REFERENCES nexora_connection_operations_v2(id,connection_id,tenant_id,workspace_id)
);

INSERT INTO nexora_connections_v2 SELECT * FROM nexora_connections;
INSERT INTO nexora_connection_operations_v2 SELECT * FROM nexora_connection_operations;
INSERT INTO nexora_connection_events_v2 SELECT * FROM nexora_connection_events;

DROP TABLE nexora_connection_events;
DROP TABLE nexora_connection_operations;
DROP TABLE nexora_connections;

ALTER TABLE nexora_connections_v2 RENAME TO nexora_connections;
ALTER TABLE nexora_connection_operations_v2 RENAME TO nexora_connection_operations;
ALTER TABLE nexora_connection_events_v2 RENAME TO nexora_connection_events;

CREATE INDEX idx_nexora_connections_scope ON nexora_connections(tenant_id,workspace_id,provider,state);
CREATE INDEX idx_nexora_connections_retry ON nexora_connections(next_eligible_retry_at,circuit_open_until) WHERE state IN ('RETRY_WAIT','DEGRADED');
CREATE INDEX idx_nexora_connections_lease ON nexora_connections(lease_expires_at) WHERE lease_owner IS NOT NULL;
CREATE INDEX idx_nexora_connection_operations_claim ON nexora_connection_operations(tenant_id,workspace_id,state,created_at);
CREATE UNIQUE INDEX uq_nexora_connection_operation_auth_session ON nexora_connection_operations(authorization_session_id) WHERE authorization_session_id IS NOT NULL;
CREATE UNIQUE INDEX uq_nexora_connection_operation_callback ON nexora_connection_operations(callback_correlation_id) WHERE callback_correlation_id IS NOT NULL;
CREATE INDEX idx_nexora_connection_events_scope ON nexora_connection_events(tenant_id,workspace_id,connection_id,connection_generation);

CREATE TRIGGER trg_nexora_connection_initial_state
BEFORE INSERT ON nexora_connections WHEN NEW.state<>'DISCOVERED'
BEGIN SELECT RAISE(ABORT,'nexora_connection_initial_state_must_be_discovered'); END;

CREATE TRIGGER trg_nexora_connection_binding_immutable
BEFORE UPDATE OF tenant_id,workspace_id,normalized_domain,domain_authority_id,provider,account_id ON nexora_connections
WHEN NEW.tenant_id<>OLD.tenant_id OR NEW.workspace_id<>OLD.workspace_id OR NEW.normalized_domain<>OLD.normalized_domain OR NEW.domain_authority_id<>OLD.domain_authority_id OR NEW.provider<>OLD.provider OR NEW.account_id<>OLD.account_id
BEGIN SELECT RAISE(ABORT,'nexora_connection_binding_immutable'); END;

CREATE TRIGGER trg_nexora_connection_mission_association_guarded
BEFORE UPDATE OF onboarding_mission_id ON nexora_connections
WHEN COALESCE(NEW.onboarding_mission_id,'')<>COALESCE(OLD.onboarding_mission_id,'') AND NOT (
 (OLD.state='DISCOVERED' AND NEW.state='AUTHORIZATION_PENDING' AND OLD.onboarding_mission_id IS NULL AND NEW.onboarding_mission_id IS NOT NULL) OR
 (OLD.state='REAUTHORIZATION_REQUIRED' AND NEW.state='AUTHORIZATION_PENDING' AND OLD.onboarding_mission_id IS NOT NULL AND NEW.onboarding_mission_id IS NOT NULL)
)
BEGIN SELECT RAISE(ABORT,'nexora_connection_mission_association_invalid'); END;

CREATE TRIGGER trg_nexora_connection_legal_transition
BEFORE UPDATE OF state ON nexora_connections WHEN NEW.state<>OLD.state AND NOT (
 (OLD.state='DISCOVERED' AND NEW.state IN ('AUTHORIZATION_PENDING','CONNECTED','REAUTHORIZATION_REQUIRED','SUSPENDED','REVOKED','FAILED_TERMINAL')) OR
 (OLD.state='AUTHORIZATION_PENDING' AND NEW.state IN ('CALLBACK_PENDING','CONNECTED','REAUTHORIZATION_REQUIRED','SUSPENDED','REVOKED','FAILED_TERMINAL')) OR
 (OLD.state='CALLBACK_PENDING' AND NEW.state IN ('CONNECTED','REAUTHORIZATION_REQUIRED','RETRY_WAIT','SUSPENDED','REVOKED','FAILED_TERMINAL')) OR
 (OLD.state='CONNECTED' AND NEW.state IN ('HEALTHY','DEGRADED','RETRY_WAIT','REAUTHORIZATION_REQUIRED','SUSPENDED','REVOKED','DISCONNECTED','FAILED_TERMINAL')) OR
 (OLD.state='HEALTHY' AND NEW.state IN ('REFRESH_PENDING','DEGRADED','RETRY_WAIT','REAUTHORIZATION_REQUIRED','SUSPENDED','REVOKED','DISCONNECTED','FAILED_TERMINAL')) OR
 (OLD.state='REFRESH_PENDING' AND NEW.state IN ('HEALTHY','DEGRADED','RETRY_WAIT','REAUTHORIZATION_REQUIRED','SUSPENDED','REVOKED','FAILED_TERMINAL')) OR
 (OLD.state='DEGRADED' AND NEW.state IN ('HEALTHY','REFRESH_PENDING','RETRY_WAIT','REAUTHORIZATION_REQUIRED','SUSPENDED','REVOKED','DISCONNECTED','FAILED_TERMINAL')) OR
 (OLD.state='RETRY_WAIT' AND NEW.state IN ('HEALTHY','REFRESH_PENDING','DEGRADED','REAUTHORIZATION_REQUIRED','SUSPENDED','REVOKED','FAILED_TERMINAL')) OR
 (OLD.state='REAUTHORIZATION_REQUIRED' AND NEW.state IN ('AUTHORIZATION_PENDING','SUSPENDED','REVOKED','FAILED_TERMINAL')) OR
 (OLD.state='SUSPENDED' AND NEW.state IN ('DISCOVERED','REVOKED')) OR
 (OLD.state='DISCONNECTED' AND NEW.state IN ('DISCOVERED','AUTHORIZATION_PENDING','REVOKED'))
)
BEGIN SELECT RAISE(ABORT,'nexora_connection_illegal_transition'); END;

CREATE TRIGGER trg_nexora_connection_transition_authority
BEFORE UPDATE OF state ON nexora_connections WHEN NEW.state<>OLD.state AND NOT (
 NEW.connection_generation=OLD.connection_generation+1 AND
 NEW.last_transition_event_id IS NOT NULL AND
 OLD.lease_owner IS NOT NULL AND OLD.lease_expires_at>CURRENT_TIMESTAMP AND
 EXISTS (
  SELECT 1 FROM nexora_connection_events e
  JOIN nexora_connection_operations o ON o.id=e.operation_id AND o.connection_id=e.connection_id AND o.tenant_id=e.tenant_id AND o.workspace_id=e.workspace_id
  JOIN mission_runtime_evidence me ON me.id=o.evidence_id AND me.tenant_id=o.tenant_id AND me.workspace_id=o.workspace_id AND me.status='supported'
  JOIN mission_runtime_verifications mv ON mv.id=o.verification_id AND mv.evidence_id=me.id AND mv.claim_id=o.claim_id AND mv.tenant_id=o.tenant_id AND mv.workspace_id=o.workspace_id AND mv.state='verified' AND mv.integrity_state='valid' AND mv.verifier='canonical_connection_policy_v1'
  WHERE e.id=NEW.last_transition_event_id AND e.connection_id=OLD.id AND e.tenant_id=OLD.tenant_id AND e.workspace_id=OLD.workspace_id
   AND e.from_state=OLD.state AND e.to_state=NEW.state AND e.connection_generation=NEW.connection_generation
   AND e.fencing_token=OLD.fencing_token AND o.state='VERIFIED'
   AND o.transition_from_state=OLD.state AND o.transition_to_state=NEW.state
   AND o.expected_authority_generation=OLD.authority_generation
   AND o.expected_connection_generation=OLD.connection_generation
   AND o.expected_credential_generation=OLD.credential_generation
   AND o.claim_id='connection-claim:'||o.id
   AND json_extract(me.summary_json,'$.operation_id')=o.id
   AND o.lease_owner=OLD.lease_owner AND o.fencing_token=OLD.fencing_token AND o.lease_expires_at=OLD.lease_expires_at
 )
)
BEGIN SELECT RAISE(ABORT,'nexora_connection_transition_authority_required'); END;

CREATE TRIGGER trg_nexora_connection_authority_fields_guarded
BEFORE UPDATE ON nexora_connections WHEN NEW.state=OLD.state AND (
 NEW.domain_authority_generation<>OLD.domain_authority_generation OR
 NEW.authority_generation<>OLD.authority_generation OR
 NEW.connection_generation<>OLD.connection_generation OR
 COALESCE(NEW.provider_connection_id,'')<>COALESCE(OLD.provider_connection_id,'') OR
 NEW.provider_connection_generation<>OLD.provider_connection_generation OR
 COALESCE(NEW.credential_reference_id,'')<>COALESCE(OLD.credential_reference_id,'') OR
 NEW.credential_generation<>OLD.credential_generation OR
 COALESCE(NEW.last_transition_event_id,'')<>COALESCE(OLD.last_transition_event_id,'')
) AND NOT (
 NEW.credential_generation=OLD.credential_generation+1 AND
 NEW.domain_authority_generation=OLD.domain_authority_generation AND NEW.authority_generation=OLD.authority_generation AND
 NEW.connection_generation=OLD.connection_generation AND COALESCE(NEW.provider_connection_id,'')=COALESCE(OLD.provider_connection_id,'') AND
 NEW.provider_connection_generation=OLD.provider_connection_generation AND COALESCE(NEW.credential_reference_id,'')=COALESCE(OLD.credential_reference_id,'') AND
 COALESCE(NEW.last_transition_event_id,'')=COALESCE(OLD.last_transition_event_id,'') AND
 EXISTS (SELECT 1 FROM nexora_onboarding_tokens t JOIN nexora_onboarding_token_connection_bindings b ON b.token_id=t.id AND b.token_generation=t.rotation_generation WHERE t.id=OLD.credential_reference_id AND t.rotation_generation=NEW.credential_generation AND b.connection_id=OLD.provider_connection_id)
)
BEGIN SELECT RAISE(ABORT,'nexora_connection_authority_fields_require_transition'); END;

CREATE TRIGGER trg_nexora_connection_lease_session_guarded
BEFORE UPDATE ON nexora_connections WHEN NEW.state=OLD.state AND (
 COALESCE(NEW.lease_owner,'')<>COALESCE(OLD.lease_owner,'') OR
 COALESCE(NEW.lease_expires_at,'')<>COALESCE(OLD.lease_expires_at,'') OR
 NEW.fencing_token<>OLD.fencing_token OR
 NEW.provider_session_generation<>OLD.provider_session_generation
) AND NOT (
 (NEW.lease_owner IS NOT NULL AND NEW.lease_expires_at>CURRENT_TIMESTAMP AND NEW.fencing_token=OLD.fencing_token+1 AND NEW.provider_session_generation=OLD.provider_session_generation AND (OLD.lease_owner IS NULL OR OLD.lease_expires_at<CURRENT_TIMESTAMP)) OR
 (OLD.lease_owner IS NOT NULL AND NEW.lease_owner IS NULL AND NEW.lease_expires_at IS NULL AND NEW.fencing_token=OLD.fencing_token AND NEW.provider_session_generation=OLD.provider_session_generation) OR
 (OLD.lease_owner IS NOT NULL AND OLD.lease_expires_at>CURRENT_TIMESTAMP AND NEW.lease_owner=OLD.lease_owner AND NEW.lease_expires_at=OLD.lease_expires_at AND NEW.fencing_token=OLD.fencing_token AND NEW.provider_session_generation=OLD.provider_session_generation+1)
)
BEGIN SELECT RAISE(ABORT,'nexora_connection_lease_session_authority_invalid'); END;

CREATE TRIGGER trg_nexora_connection_operation_authority_immutable
BEFORE UPDATE ON nexora_connection_operations WHEN
 NEW.connection_id<>OLD.connection_id OR NEW.tenant_id<>OLD.tenant_id OR NEW.workspace_id<>OLD.workspace_id OR
 NEW.operation_type<>OLD.operation_type OR NEW.idempotency_key<>OLD.idempotency_key OR
 COALESCE(NEW.authorization_session_id,'')<>COALESCE(OLD.authorization_session_id,'') OR
 NEW.expected_authority_generation<>OLD.expected_authority_generation OR
 NEW.expected_connection_generation<>OLD.expected_connection_generation OR
 NEW.expected_credential_generation<>OLD.expected_credential_generation OR
 NEW.request_digest<>OLD.request_digest OR NEW.authority_tuple_digest<>OLD.authority_tuple_digest OR
 OLD.state='VERIFIED'
BEGIN SELECT RAISE(ABORT,'nexora_connection_operation_authority_immutable'); END;

CREATE TRIGGER trg_nexora_connection_operation_state_progression
BEFORE UPDATE OF state ON nexora_connection_operations WHEN NEW.state<>OLD.state AND NOT (
 (OLD.state='PENDING' AND NEW.state IN ('LEASED','BLOCKED','FAILED')) OR
 (OLD.state='LEASED' AND NEW.state IN ('PROVIDER_RESPONSE_OBSERVED','VERIFIED','RETRY_WAIT','BLOCKED','FAILED')) OR
 (OLD.state='PROVIDER_RESPONSE_OBSERVED' AND NEW.state IN ('EVIDENCE_WRITTEN','VERIFIED','RETRY_WAIT','BLOCKED','FAILED')) OR
 (OLD.state='EVIDENCE_WRITTEN' AND NEW.state IN ('VERIFIED','BLOCKED','FAILED')) OR
 (OLD.state='RETRY_WAIT' AND NEW.state IN ('LEASED','BLOCKED','FAILED'))
)
BEGIN SELECT RAISE(ABORT,'nexora_connection_operation_state_invalid'); END;

CREATE TRIGGER trg_nexora_connection_events_no_update
BEFORE UPDATE ON nexora_connection_events
BEGIN SELECT RAISE(ABORT,'nexora_connection_events_immutable'); END;

CREATE TRIGGER trg_nexora_connection_events_no_delete
BEFORE DELETE ON nexora_connection_events
BEGIN SELECT RAISE(ABORT,'nexora_connection_events_immutable'); END;
