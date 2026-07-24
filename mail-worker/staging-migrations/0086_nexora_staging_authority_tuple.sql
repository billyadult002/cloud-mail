-- Staging-only, one-shot first authority tuple ceremony.
-- It extends the retired bootstrap ledger without re-enabling its endpoint or secret.

CREATE TABLE IF NOT EXISTS nexora_staging_authority_tuple_operations (
 singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
 operation_id TEXT NOT NULL UNIQUE,
 request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
 state TEXT NOT NULL CHECK(state IN ('IDENTITY_READY','DNS_CHALLENGE_READY','TUPLE_CREATED','COMPLETE','REVOCATION_PENDING','REVOKED')),
 normalized_domain TEXT NOT NULL,
 user_id INTEGER,
 tenant_id INTEGER,
 workspace_id INTEGER,
 account_id INTEGER,
 membership_authority_id TEXT,
 domain_challenge_id TEXT,
 domain_challenge_generation INTEGER,
 domain_challenge_token_hash TEXT CHECK(domain_challenge_token_hash IS NULL OR length(domain_challenge_token_hash)=64),
 challenge_expires_at TEXT NOT NULL,
 domain_authority_id TEXT,
 domain_authority_generation INTEGER,
 delegation_authority_id TEXT,
 delegation_authority_generation INTEGER,
 authority_tuple_digest TEXT CHECK(authority_tuple_digest IS NULL OR length(authority_tuple_digest)=64),
 evidence_id TEXT,
 verification_id TEXT,
 revocation_evidence_id TEXT,
 revocation_verification_id TEXT,
 worker_version TEXT NOT NULL,
 completed_at TEXT,
 revoked_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS workspace_account_delegation_authority_bindings (
 delegation_id TEXT PRIMARY KEY,
 tenant_key TEXT NOT NULL,
 workspace_id INTEGER NOT NULL,
 account_id INTEGER NOT NULL,
 membership_authority_id TEXT NOT NULL,
 membership_authority_generation INTEGER NOT NULL CHECK(membership_authority_generation>0),
 domain_authority_id TEXT NOT NULL,
 domain_authority_generation INTEGER NOT NULL CHECK(domain_authority_generation>0),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS trg_nexora_staging_authority_tuple_no_delete
BEFORE DELETE ON nexora_staging_authority_tuple_operations
BEGIN
 SELECT RAISE(ABORT,'staging_authority_tuple_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_nexora_staging_authority_tuple_valid_update
BEFORE UPDATE ON nexora_staging_authority_tuple_operations
WHEN
 OLD.singleton_id<>NEW.singleton_id
 OR OLD.operation_id<>NEW.operation_id
 OR OLD.request_digest<>NEW.request_digest
 OR OLD.normalized_domain<>NEW.normalized_domain
 OR OLD.worker_version<>NEW.worker_version
 OR OLD.created_at<>NEW.created_at
 OR OLD.state='REVOKED'
 OR NOT (
  (OLD.state='IDENTITY_READY' AND NEW.state='DNS_CHALLENGE_READY'
   AND NEW.domain_challenge_id IS NOT NULL AND NEW.domain_challenge_generation>0)
  OR (OLD.state='DNS_CHALLENGE_READY' AND NEW.state='TUPLE_CREATED'
   AND NEW.domain_authority_id IS NOT NULL AND NEW.domain_authority_generation>0
   AND NEW.delegation_authority_id IS NOT NULL AND NEW.delegation_authority_generation>0
   AND length(NEW.authority_tuple_digest)=64
   AND NEW.evidence_id IS NOT NULL AND NEW.verification_id IS NULL
   AND NEW.completed_at IS NULL)
  OR (OLD.state='TUPLE_CREATED' AND NEW.state='COMPLETE'
   AND NEW.verification_id IS NOT NULL AND NEW.completed_at IS NOT NULL)
  OR (OLD.state IN ('IDENTITY_READY','DNS_CHALLENGE_READY') AND NEW.state='REVOKED'
   AND NEW.revoked_at IS NOT NULL
   AND NEW.revocation_evidence_id IS NULL AND NEW.revocation_verification_id IS NULL)
  OR (OLD.state IN ('TUPLE_CREATED','COMPLETE') AND NEW.state='REVOCATION_PENDING'
   AND NEW.revoked_at IS NOT NULL AND NEW.revocation_evidence_id IS NOT NULL
   AND NEW.revocation_verification_id IS NULL)
  OR (OLD.state='REVOCATION_PENDING' AND NEW.state='REVOKED'
   AND NEW.revocation_verification_id IS NOT NULL)
 )
BEGIN
 SELECT RAISE(ABORT,'staging_authority_tuple_invalid_transition');
END;

CREATE UNIQUE INDEX IF NOT EXISTS uq_nexora_staging_mail_read_delegation
ON workspace_account_delegations(workspace_id,account_id,subject_user_id)
WHERE state IN ('pending_owner_consent','pending_approval','active')
  AND scope_json='["mail_read"]';
