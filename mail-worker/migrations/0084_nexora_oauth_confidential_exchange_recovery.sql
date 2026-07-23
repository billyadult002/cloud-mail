-- Checkpoint 5 remediation: additive, sealed OAuth exchange recovery authority.
-- This schema stores hashes, opaque references, and AES-GCM ciphertext only. It
-- must never contain an authorization code, callback query, PKCE verifier, or
-- plaintext provider credential.

CREATE TABLE IF NOT EXISTS nexora_oauth_authorization_session_bindings (
 authorization_session_id TEXT PRIMARY KEY,
 onboarding_mission_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
 runtime_mode TEXT NOT NULL DEFAULT 'LEGACY' CHECK(runtime_mode IN ('LEGACY','CONNECTION_RUNTIME')),
 connection_id TEXT,
 connection_generation INTEGER CHECK(connection_generation IS NULL OR connection_generation>=0),
 authority_generation INTEGER CHECK(authority_generation IS NULL OR authority_generation>=0),
 account_id INTEGER,
 account_owner_user_id INTEGER,
 domain_authority_id TEXT,
 domain_authority_generation INTEGER CHECK(domain_authority_generation IS NULL OR domain_authority_generation>0),
 authority_kind TEXT CHECK(authority_kind IS NULL OR authority_kind IN ('ACCOUNT_OWNER','ACCOUNT_DELEGATION')),
 membership_authority_id TEXT,
 membership_authority_generation INTEGER CHECK(membership_authority_generation IS NULL OR membership_authority_generation>0),
 delegation_authority_id TEXT,
 delegation_authority_generation INTEGER CHECK(delegation_authority_generation IS NULL OR delegation_authority_generation>0),
 redirect_uri_hash TEXT NOT NULL,
 oauth_client_fingerprint TEXT NOT NULL,
 scope_manifest_version TEXT NOT NULL,
 scope_manifest_digest TEXT NOT NULL,
 issued_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 callback_receipt_status TEXT NOT NULL DEFAULT 'NOT_RECEIVED' CHECK(callback_receipt_status IN ('NOT_RECEIVED','RECEIVED','REJECTED')),
 exchange_status TEXT NOT NULL DEFAULT 'EXCHANGE_NOT_STARTED' CHECK(exchange_status IN ('EXCHANGE_NOT_STARTED','EXCHANGE_IN_PROGRESS','EXCHANGE_FAILED_RETRYABLE','EXCHANGE_FAILED_TERMINAL','EXCHANGE_SUCCEEDED_COMMIT_PENDING','CREDENTIAL_STORED_CONNECTION_PENDING','CONNECTION_COMMITTED_VERIFICATION_PENDING','CALLBACK_VERIFIED','RECOVERY_REQUIRED','REAUTHORIZATION_REQUIRED')),
 recovery_status TEXT NOT NULL DEFAULT 'NONE' CHECK(recovery_status IN ('NONE','SEALED_RECEIPT_AVAILABLE','RECOVERY_IN_PROGRESS','RECOVERY_REQUIRED','REAUTHORIZATION_REQUIRED','COMPLETED')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(authorization_session_id) REFERENCES nexora_onboarding_authorization_sessions(id),
 UNIQUE(tenant_id,workspace_id,connection_id,authorization_session_id)
);
CREATE INDEX IF NOT EXISTS idx_nexora_oauth_session_binding_scope ON nexora_oauth_authorization_session_bindings(tenant_id,workspace_id,connection_id,authorization_session_id);

CREATE TABLE IF NOT EXISTS nexora_oauth_callback_intakes (
 id TEXT PRIMARY KEY,
 authorization_session_id TEXT NOT NULL UNIQUE,
 callback_correlation_id TEXT NOT NULL UNIQUE,
 callback_claim_id TEXT NOT NULL,
 onboarding_mission_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
 payload_ciphertext TEXT NOT NULL,
 payload_digest TEXT NOT NULL,
 payload_expires_at TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','PROCESSING','COMPLETED','RECOVERY_REQUIRED','REAUTHORIZATION_REQUIRED')),
 lease_owner TEXT,
 lease_expires_at TEXT,
 fencing_token INTEGER NOT NULL DEFAULT 0,
 attempt INTEGER NOT NULL DEFAULT 0,
 terminal_reason_code TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TEXT,
 FOREIGN KEY(authorization_session_id) REFERENCES nexora_onboarding_authorization_sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_nexora_oauth_callback_intake_recovery ON nexora_oauth_callback_intakes(state,payload_expires_at,lease_expires_at);

CREATE TABLE IF NOT EXISTS nexora_oauth_exchange_attempts (
 id TEXT PRIMARY KEY,
 authorization_session_id TEXT NOT NULL UNIQUE,
 callback_correlation_id TEXT NOT NULL UNIQUE,
 callback_claim_id TEXT NOT NULL,
 onboarding_mission_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
 connection_id TEXT,
 expected_connection_generation INTEGER,
 expected_authority_generation INTEGER,
 exchange_owner TEXT NOT NULL,
 lease_expires_at TEXT NOT NULL,
 fencing_token INTEGER NOT NULL CHECK(fencing_token>0),
 idempotency_key TEXT NOT NULL UNIQUE,
 request_digest TEXT NOT NULL,
 provider_request_reference TEXT,
 state TEXT NOT NULL CHECK(state IN ('EXCHANGE_IN_PROGRESS','EXCHANGE_FAILED_RETRYABLE','EXCHANGE_FAILED_TERMINAL','EXCHANGE_SUCCEEDED_COMMIT_PENDING','CREDENTIAL_STORED_CONNECTION_PENDING','CONNECTION_COMMITTED_VERIFICATION_PENDING','CALLBACK_VERIFIED','RECOVERY_REQUIRED','REAUTHORIZATION_REQUIRED')),
 receipt_ciphertext TEXT,
 receipt_digest TEXT,
 receipt_expires_at TEXT,
 credential_reference_id TEXT,
 provider_connection_id TEXT,
 provider_connection_generation INTEGER,
 terminal_reason_code TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TEXT,
 FOREIGN KEY(authorization_session_id) REFERENCES nexora_onboarding_authorization_sessions(id)
);
CREATE INDEX IF NOT EXISTS idx_nexora_oauth_exchange_scope ON nexora_oauth_exchange_attempts(tenant_id,workspace_id,onboarding_mission_id,authorization_session_id);
CREATE INDEX IF NOT EXISTS idx_nexora_oauth_exchange_recovery ON nexora_oauth_exchange_attempts(state,receipt_expires_at,lease_expires_at);

-- One reusable, commit-time authority relation.  Every OAuth write boundary joins
-- this view so a cached Connection tuple cannot outlive its underlying Account,
-- Workspace membership/delegation, or Domain Authority.
CREATE VIEW IF NOT EXISTS nexora_oauth_live_authorization_bindings AS
SELECT b.authorization_session_id
FROM nexora_oauth_authorization_session_bindings b
WHERE b.runtime_mode='LEGACY'
  AND b.connection_id IS NULL
  AND b.connection_generation IS NULL
  AND b.authority_generation IS NULL
  AND b.account_id IS NULL
  AND b.account_owner_user_id IS NULL
  AND b.domain_authority_id IS NULL
  AND b.domain_authority_generation IS NULL
  AND b.authority_kind IS NULL
  AND b.membership_authority_id IS NULL
  AND b.membership_authority_generation IS NULL
  AND b.delegation_authority_id IS NULL
  AND b.delegation_authority_generation IS NULL
UNION ALL
SELECT b.authorization_session_id
FROM nexora_oauth_authorization_session_bindings b
JOIN nexora_connections cn
  ON cn.id=b.connection_id
 AND cn.tenant_id=b.tenant_id AND cn.workspace_id=b.workspace_id
 AND cn.authority_generation=b.authority_generation
 AND cn.account_id=b.account_id
 AND cn.domain_authority_id=b.domain_authority_id
 AND cn.domain_authority_generation=b.domain_authority_generation
JOIN nexora_domain_authorities da
  ON da.id=b.domain_authority_id
 AND da.tenant_id=b.tenant_id AND da.workspace_id=b.workspace_id
 AND da.generation=b.domain_authority_generation
 AND da.verification_status='verified' AND da.revoked_at IS NULL
JOIN account a
  ON a.account_id=b.account_id
 AND a.user_id=b.account_owner_user_id
 AND a.is_del=0
JOIN workspaces w ON w.id=b.workspace_id
JOIN workspace_members wm
  ON wm.workspace_id=b.workspace_id AND wm.user_id=b.tenant_id
WHERE
 b.runtime_mode='CONNECTION_RUNTIME'
 AND
 ((b.authority_kind='ACCOUNT_OWNER'
  AND b.account_owner_user_id=b.tenant_id
  AND b.authority_generation=0
  AND b.membership_authority_id IS NULL
  AND b.delegation_authority_id IS NULL)
 OR
 (b.authority_kind='ACCOUNT_DELEGATION'
  AND b.account_owner_user_id<>b.tenant_id
  AND EXISTS (
   SELECT 1
   FROM workspace_membership_authorities ma
   WHERE ma.id=b.membership_authority_id
     AND ma.workspace_id=b.workspace_id
     AND ma.subject_user_id=b.tenant_id
     AND ma.tenant_key=w.tenant_key
     AND ma.authority_generation=b.membership_authority_generation
     AND ma.state='active'
     AND (ma.expires_at IS NULL OR ma.expires_at>CURRENT_TIMESTAMP)
  )
  AND EXISTS (
   SELECT 1
   FROM workspace_account_delegations d
   WHERE d.id=b.delegation_authority_id
     AND d.workspace_id=b.workspace_id
     AND d.account_id=b.account_id
     AND d.owner_user_id=b.account_owner_user_id
     AND d.subject_user_id=b.tenant_id
     AND d.tenant_key=w.tenant_key
     AND d.authority_generation=b.delegation_authority_generation
     AND d.authority_generation=b.authority_generation
     AND d.state='active'
     AND d.owner_consent_at IS NOT NULL
     AND d.approved_at IS NOT NULL
     AND d.expires_at>CURRENT_TIMESTAMP
     AND EXISTS (
      SELECT 1 FROM json_each(d.scope_json)
      WHERE value='account_state_visibility'
     )
  )));

CREATE TRIGGER IF NOT EXISTS trg_nexora_oauth_exchange_tuple_guard
BEFORE INSERT ON nexora_oauth_exchange_attempts
WHEN NOT EXISTS (
 SELECT 1
 FROM nexora_onboarding_authorization_sessions s
 JOIN nexora_onboarding_callback_correlations co
   ON co.authorization_session_id=s.id
  AND co.id=NEW.callback_correlation_id
 JOIN nexora_onboarding_callback_claims cc
   ON cc.authorization_session_id=s.id
  AND cc.correlation_id=co.id
  AND cc.id=NEW.callback_claim_id
 JOIN nexora_oauth_authorization_session_bindings b
   ON b.authorization_session_id=s.id
 JOIN nexora_oauth_live_authorization_bindings la
   ON la.authorization_session_id=b.authorization_session_id
 LEFT JOIN nexora_connections cn
   ON cn.id=b.connection_id
  AND cn.tenant_id=b.tenant_id
  AND cn.workspace_id=b.workspace_id
 WHERE s.id=NEW.authorization_session_id
   AND s.onboarding_mission_id=NEW.onboarding_mission_id
   AND s.tenant_id=NEW.tenant_id AND s.workspace_id=NEW.workspace_id
   AND s.provider=NEW.provider AND s.status='consumed'
   AND co.onboarding_mission_id=NEW.onboarding_mission_id
   AND co.tenant_id=NEW.tenant_id AND co.workspace_id=NEW.workspace_id
   AND co.provider=NEW.provider
   AND cc.onboarding_mission_id=NEW.onboarding_mission_id
   AND cc.tenant_id=NEW.tenant_id AND cc.workspace_id=NEW.workspace_id
   AND cc.provider=NEW.provider
   AND cc.lease_owner=NEW.exchange_owner
   AND cc.fencing_token=NEW.fencing_token
   AND cc.lease_expires_at>CURRENT_TIMESTAMP
   AND cc.claim_status IN ('CLAIMED','PROCESSING')
   AND cc.recovery_mode='EXECUTION'
   AND b.onboarding_mission_id=NEW.onboarding_mission_id
   AND b.tenant_id=NEW.tenant_id AND b.workspace_id=NEW.workspace_id
   AND b.provider=NEW.provider
   AND (
    (b.runtime_mode='LEGACY'
     AND b.connection_id IS NULL
     AND NEW.connection_id IS NULL
     AND NEW.expected_connection_generation IS NULL
     AND NEW.expected_authority_generation IS NULL)
    OR
    (b.runtime_mode='CONNECTION_RUNTIME'
     AND b.connection_id=NEW.connection_id
     AND b.connection_generation=NEW.expected_connection_generation
     AND b.authority_generation=NEW.expected_authority_generation
     AND cn.connection_generation=NEW.expected_connection_generation
     AND cn.authority_generation=NEW.expected_authority_generation
     AND cn.state='AUTHORIZATION_PENDING')
   )
)
BEGIN SELECT RAISE(ABORT,'nexora_oauth_exchange_tuple_invalid'); END;

CREATE TRIGGER IF NOT EXISTS trg_nexora_oauth_exchange_seal_live_authority
BEFORE UPDATE OF state,receipt_ciphertext,receipt_digest,receipt_expires_at ON nexora_oauth_exchange_attempts
WHEN OLD.state='EXCHANGE_IN_PROGRESS'
 AND NEW.state IN ('EXCHANGE_FAILED_RETRYABLE','EXCHANGE_FAILED_TERMINAL','EXCHANGE_SUCCEEDED_COMMIT_PENDING')
 AND NOT EXISTS (
  SELECT 1 FROM nexora_oauth_live_authorization_bindings la
  WHERE la.authorization_session_id=NEW.authorization_session_id
 )
BEGIN SELECT RAISE(ABORT,'nexora_oauth_exchange_seal_live_authority_missing'); END;

CREATE TRIGGER IF NOT EXISTS trg_nexora_oauth_callback_connection_live_authority
BEFORE UPDATE OF state ON nexora_connections
WHEN OLD.state='AUTHORIZATION_PENDING' AND NEW.state='CONNECTED'
 AND EXISTS (
  SELECT 1
  FROM nexora_connection_events e
  JOIN nexora_connection_operations op
    ON op.id=e.operation_id AND op.connection_id=e.connection_id
  WHERE e.id=NEW.last_transition_event_id
    AND e.connection_id=OLD.id
    AND op.operation_type='CALLBACK'
 )
 AND NOT EXISTS (
  SELECT 1
  FROM nexora_connection_events e
  JOIN nexora_connection_operations op
    ON op.id=e.operation_id AND op.connection_id=e.connection_id
  JOIN nexora_oauth_exchange_attempts ea
    ON ea.callback_correlation_id=op.callback_correlation_id
   AND ea.connection_id=OLD.id
   AND ea.state='CONNECTION_COMMITTED_VERIFICATION_PENDING'
   AND ea.provider_connection_id=NEW.provider_connection_id
   AND ea.provider_connection_generation=NEW.provider_connection_generation
   AND ea.credential_reference_id=NEW.credential_reference_id
  JOIN nexora_oauth_authorization_session_bindings b
    ON b.authorization_session_id=ea.authorization_session_id
   AND b.connection_id=OLD.id
   AND b.tenant_id=OLD.tenant_id AND b.workspace_id=OLD.workspace_id
   AND b.connection_generation=OLD.connection_generation
   AND b.authority_generation=OLD.authority_generation
  JOIN nexora_oauth_live_authorization_bindings la
    ON la.authorization_session_id=b.authorization_session_id
  WHERE e.id=NEW.last_transition_event_id
    AND e.connection_id=OLD.id
    AND op.operation_type='CALLBACK'
    AND EXISTS (
     SELECT 1 FROM nexora_callback_verified_results vr
     WHERE vr.authorization_session_id=ea.authorization_session_id
       AND vr.callback_correlation_id=ea.callback_correlation_id
       AND vr.tenant_id=OLD.tenant_id AND vr.workspace_id=OLD.workspace_id
       AND vr.mission_id=b.onboarding_mission_id
       AND vr.provider=b.provider
       AND vr.result_status='VERIFIED'
       AND vr.provider_connection_id=ea.provider_connection_id
       AND vr.provider_connection_generation=ea.provider_connection_generation
       AND vr.token_generation=NEW.credential_generation
    )
 )
BEGIN SELECT RAISE(ABORT,'nexora_oauth_callback_connection_live_authority_missing'); END;

CREATE TRIGGER IF NOT EXISTS trg_nexora_oauth_exchange_receipt_requires_digest
BEFORE UPDATE OF state,receipt_ciphertext,receipt_digest ON nexora_oauth_exchange_attempts
WHEN NEW.state='EXCHANGE_SUCCEEDED_COMMIT_PENDING'
 AND (NEW.receipt_ciphertext IS NULL OR NEW.receipt_digest IS NULL OR NEW.receipt_expires_at IS NULL)
BEGIN SELECT RAISE(ABORT,'nexora_oauth_exchange_receipt_incomplete'); END;

CREATE TRIGGER IF NOT EXISTS trg_nexora_oauth_exchange_no_reopen
BEFORE UPDATE OF state ON nexora_oauth_exchange_attempts
WHEN OLD.state IN ('CALLBACK_VERIFIED','REAUTHORIZATION_REQUIRED')
 AND NEW.state<>OLD.state
BEGIN SELECT RAISE(ABORT,'nexora_oauth_exchange_terminal'); END;

CREATE TRIGGER IF NOT EXISTS trg_nexora_oauth_exchange_legal_transition
BEFORE UPDATE OF state ON nexora_oauth_exchange_attempts
WHEN NOT (
 (OLD.state='EXCHANGE_IN_PROGRESS' AND NEW.state IN ('EXCHANGE_FAILED_RETRYABLE','EXCHANGE_FAILED_TERMINAL','EXCHANGE_SUCCEEDED_COMMIT_PENDING','RECOVERY_REQUIRED','REAUTHORIZATION_REQUIRED')) OR
 (OLD.state='EXCHANGE_SUCCEEDED_COMMIT_PENDING' AND NEW.state IN ('CREDENTIAL_STORED_CONNECTION_PENDING','RECOVERY_REQUIRED','REAUTHORIZATION_REQUIRED')) OR
 (OLD.state='CREDENTIAL_STORED_CONNECTION_PENDING' AND NEW.state IN ('CONNECTION_COMMITTED_VERIFICATION_PENDING','RECOVERY_REQUIRED','REAUTHORIZATION_REQUIRED')) OR
 (OLD.state='CONNECTION_COMMITTED_VERIFICATION_PENDING' AND NEW.state IN ('CALLBACK_VERIFIED','RECOVERY_REQUIRED','REAUTHORIZATION_REQUIRED')) OR
 (OLD.state='RECOVERY_REQUIRED' AND NEW.state='REAUTHORIZATION_REQUIRED') OR
 NEW.state=OLD.state
)
BEGIN SELECT RAISE(ABORT,'nexora_oauth_exchange_transition_invalid'); END;

CREATE TRIGGER IF NOT EXISTS trg_nexora_oauth_exchange_verified_authority
BEFORE UPDATE OF state ON nexora_oauth_exchange_attempts
WHEN NEW.state='CALLBACK_VERIFIED'
 AND NOT EXISTS (
  SELECT 1 FROM nexora_callback_verified_results vr
  JOIN nexora_onboarding_token_connection_bindings tb
    ON tb.token_id=NEW.credential_reference_id
   AND tb.connection_id=NEW.provider_connection_id
   AND tb.tenant_id=NEW.tenant_id AND tb.workspace_id=NEW.workspace_id
   AND tb.provider=NEW.provider
   AND tb.connection_generation=NEW.provider_connection_generation
  WHERE vr.mission_id=NEW.onboarding_mission_id
    AND vr.authorization_session_id=NEW.authorization_session_id
    AND vr.callback_correlation_id=NEW.callback_correlation_id
    AND vr.tenant_id=NEW.tenant_id AND vr.workspace_id=NEW.workspace_id
    AND vr.provider=NEW.provider AND vr.result_status='VERIFIED'
    AND vr.provider_connection_id=NEW.provider_connection_id
    AND vr.provider_connection_generation=NEW.provider_connection_generation
    AND vr.token_generation=tb.token_generation
 )
BEGIN SELECT RAISE(ABORT,'nexora_oauth_exchange_verified_authority_missing'); END;

-- A runtime-bound callback result cannot be inserted from a stale preflight read.
-- The exact Connection/authority tuple must still be current at the D1 write boundary.
-- The second branch permits only an idempotent result after the canonical CALLBACK
-- operation already moved that same Connection forward by exactly one generation.
CREATE TRIGGER IF NOT EXISTS trg_nexora_oauth_verified_result_live_authority
BEFORE INSERT ON nexora_callback_verified_results
WHEN EXISTS (
 SELECT 1 FROM nexora_oauth_authorization_session_bindings b
 WHERE b.authorization_session_id=NEW.authorization_session_id
   AND b.connection_id IS NOT NULL
)
AND NOT EXISTS (
 SELECT 1
 FROM nexora_oauth_authorization_session_bindings b
 JOIN nexora_oauth_live_authorization_bindings la
   ON la.authorization_session_id=b.authorization_session_id
 JOIN nexora_connections cn
   ON cn.id=b.connection_id
  AND cn.tenant_id=b.tenant_id AND cn.workspace_id=b.workspace_id
 WHERE b.authorization_session_id=NEW.authorization_session_id
   AND b.onboarding_mission_id=NEW.mission_id
   AND b.tenant_id=NEW.tenant_id AND b.workspace_id=NEW.workspace_id
   AND b.provider=NEW.provider
   AND cn.authority_generation=b.authority_generation
   AND cn.account_id=b.account_id
   AND cn.domain_authority_id=b.domain_authority_id
   AND (
    (cn.state='AUTHORIZATION_PENDING'
     AND cn.connection_generation=b.connection_generation)
    OR
    (cn.state='CONNECTED'
     AND cn.connection_generation=b.connection_generation+1
     AND cn.provider_connection_id=NEW.provider_connection_id
     AND cn.provider_connection_generation=NEW.provider_connection_generation
     AND EXISTS (
      SELECT 1 FROM nexora_connection_operations op
      WHERE op.connection_id=cn.id
        AND op.tenant_id=NEW.tenant_id AND op.workspace_id=NEW.workspace_id
        AND op.operation_type='CALLBACK'
        AND op.callback_correlation_id=NEW.callback_correlation_id
        AND op.expected_connection_generation=b.connection_generation
        AND op.state='VERIFIED'
     ))
   )
)
BEGIN SELECT RAISE(ABORT,'nexora_oauth_verified_result_live_authority_missing'); END;
