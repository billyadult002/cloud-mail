-- NEXORA P0 authority, Evidence Ledger, and acceptance correlation hardening.
-- 0077 classification rows remain the mutable current projection. The tables
-- below are the append-only system of record and contain bodyless identifiers.

ALTER TABLE nexora_domain_ownership_challenges ADD COLUMN generation INTEGER NOT NULL DEFAULT 1;
ALTER TABLE nexora_domain_ownership_challenges ADD COLUMN consumed_at TEXT;
ALTER TABLE nexora_domain_ownership_challenges ADD COLUMN superseded_at TEXT;
ALTER TABLE nexora_domain_ownership_challenges ADD COLUMN verification_operation_id TEXT;
ALTER TABLE nexora_domain_ownership_challenges ADD COLUMN hmac_key_version TEXT;
CREATE INDEX IF NOT EXISTS idx_nexora_domain_challenge_generation
 ON nexora_domain_ownership_challenges(tenant_id,workspace_id,normalized_domain,generation);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nexora_domain_challenge_verification_operation
 ON nexora_domain_ownership_challenges(verification_operation_id) WHERE verification_operation_id IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS trg_nexora_domain_challenge_hmac_key_required
 BEFORE INSERT ON nexora_domain_ownership_challenges
 WHEN NEW.hmac_key_version IS NULL OR trim(NEW.hmac_key_version)=''
 BEGIN SELECT RAISE(ABORT, 'nexora_domain_challenge_hmac_key_version_required'); END;

CREATE TRIGGER IF NOT EXISTS trg_workspace_domains_owner_immutable
 BEFORE UPDATE OF workspace_id ON workspace_domains
 WHEN NEW.workspace_id <> OLD.workspace_id
 BEGIN SELECT RAISE(ABORT, 'workspace_domain_owner_immutable'); END;

ALTER TABLE nexora_email_classifications ADD COLUMN current_event_id TEXT;
ALTER TABLE nexora_email_classifications ADD COLUMN current_evidence_id TEXT;
ALTER TABLE nexora_email_classifications ADD COLUMN canonical_message_id TEXT;
ALTER TABLE nexora_email_classifications ADD COLUMN canonical_account_id INTEGER;
ALTER TABLE nexora_email_classifications ADD COLUMN source_created_at TEXT;
ALTER TABLE nexora_email_classifications ADD COLUMN provenance_ref TEXT;

CREATE TABLE IF NOT EXISTS nexora_classification_runs (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 domain_authority_id TEXT NOT NULL,
 authority_generation INTEGER NOT NULL CHECK(authority_generation > 0),
 authority_evidence_ref TEXT NOT NULL,
 actor_user_id INTEGER NOT NULL,
 auth_session_ref TEXT NOT NULL,
 hmac_key_version TEXT NOT NULL,
 canonical_account_id INTEGER NOT NULL,
 provider_account_hash TEXT NOT NULL,
 request_id TEXT NOT NULL,
 runtime_deployment_id TEXT NOT NULL,
 acceptance_correlation_ref TEXT NOT NULL,
 client_kind TEXT NOT NULL CHECK(client_kind IN ('DESKTOP','IOS_PHYSICAL','SERVICE')),
 classifier_version TEXT NOT NULL,
 rules_version TEXT NOT NULL,
 model_version TEXT,
 input_digest TEXT NOT NULL CHECK(length(input_digest)=64),
 idempotency_key TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('COMPLETED')),
 started_at TEXT NOT NULL,
 completed_at TEXT NOT NULL,
 UNIQUE(tenant_id,workspace_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_nexora_classification_runs_correlation
 ON nexora_classification_runs(tenant_id,workspace_id,acceptance_correlation_ref,runtime_deployment_id,completed_at);
CREATE INDEX IF NOT EXISTS idx_nexora_classification_runs_authority
 ON nexora_classification_runs(tenant_id,workspace_id,domain_authority_id,authority_generation);

CREATE TABLE IF NOT EXISTS nexora_email_classification_events (
 id TEXT PRIMARY KEY,
 run_id TEXT NOT NULL,
 classification_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 customer_domain TEXT NOT NULL,
 provider TEXT NOT NULL,
 provider_account_hash TEXT NOT NULL,
 canonical_account_id INTEGER NOT NULL,
 canonical_message_id TEXT NOT NULL,
 message_fingerprint TEXT NOT NULL,
 source_created_at TEXT NOT NULL,
 provenance_ref TEXT NOT NULL,
 generation INTEGER NOT NULL CHECK(generation > 0),
 previous_event_id TEXT,
 previous_entry_digest TEXT CHECK(previous_entry_digest IS NULL OR length(previous_entry_digest)=64),
 primary_category TEXT NOT NULL,
 vip_relationship INTEGER NOT NULL CHECK(vip_relationship IN (0,1)),
 priority_level TEXT NOT NULL,
 requires_action INTEGER NOT NULL CHECK(requires_action IN (0,1)),
 time_sensitive INTEGER NOT NULL CHECK(time_sensitive IN (0,1)),
 unread INTEGER NOT NULL CHECK(unread IN (0,1)),
 starred INTEGER NOT NULL CHECK(starred IN (0,1)),
 has_attachment INTEGER NOT NULL CHECK(has_attachment IN (0,1)),
 confidence INTEGER NOT NULL CHECK(confidence BETWEEN 0 AND 100),
 reason_codes_json TEXT NOT NULL CHECK(json_valid(reason_codes_json)),
 conflicting_signals_json TEXT NOT NULL CHECK(json_valid(conflicting_signals_json)),
 authority_source TEXT NOT NULL,
 vip_authority_ref TEXT,
 user_override_ref TEXT,
 administrator_override_ref TEXT,
 decision_digest TEXT NOT NULL CHECK(length(decision_digest)=64),
 evidence_id TEXT NOT NULL UNIQUE,
 idempotency_key TEXT NOT NULL,
 classified_at TEXT NOT NULL,
 FOREIGN KEY(run_id) REFERENCES nexora_classification_runs(id),
 FOREIGN KEY(previous_event_id) REFERENCES nexora_email_classification_events(id),
 UNIQUE(tenant_id,workspace_id,customer_domain,provider,canonical_account_id,canonical_message_id,generation),
 UNIQUE(tenant_id,workspace_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_nexora_classification_events_identity
 ON nexora_email_classification_events(tenant_id,workspace_id,customer_domain,provider,canonical_account_id,canonical_message_id,generation);
CREATE INDEX IF NOT EXISTS idx_nexora_classification_events_run ON nexora_email_classification_events(run_id);

CREATE TABLE IF NOT EXISTS nexora_email_classification_evidence_v2 (
 id TEXT PRIMARY KEY,
 event_id TEXT NOT NULL UNIQUE,
 run_id TEXT NOT NULL,
 classification_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 customer_domain TEXT NOT NULL,
 provider TEXT NOT NULL,
 provider_account_hash TEXT NOT NULL,
 canonical_account_id INTEGER NOT NULL,
 canonical_message_id TEXT NOT NULL,
 message_fingerprint TEXT NOT NULL,
 source_created_at TEXT NOT NULL,
 provenance_ref TEXT NOT NULL,
 generation INTEGER NOT NULL CHECK(generation > 0),
 evidence_kind TEXT NOT NULL CHECK(evidence_kind='CLASSIFICATION_DECISION'),
 canonical_payload_json TEXT NOT NULL CHECK(json_valid(canonical_payload_json)),
 payload_digest TEXT NOT NULL CHECK(length(payload_digest)=64),
 previous_entry_digest TEXT CHECK(previous_entry_digest IS NULL OR length(previous_entry_digest)=64),
 entry_digest TEXT NOT NULL CHECK(length(entry_digest)=64),
 redaction_level TEXT NOT NULL CHECK(redaction_level='BODYLESS'),
 body_persisted INTEGER NOT NULL DEFAULT 0 CHECK(body_persisted = 0),
 observed_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(event_id) REFERENCES nexora_email_classification_events(id),
 FOREIGN KEY(run_id) REFERENCES nexora_classification_runs(id),
 UNIQUE(tenant_id,workspace_id,entry_digest)
);
CREATE INDEX IF NOT EXISTS idx_nexora_classification_evidence_identity
 ON nexora_email_classification_evidence_v2(tenant_id,workspace_id,customer_domain,provider,canonical_account_id,canonical_message_id,generation);
CREATE INDEX IF NOT EXISTS idx_nexora_classification_evidence_correlation ON nexora_email_classification_evidence_v2(run_id,event_id,classification_id);

CREATE TABLE IF NOT EXISTS nexora_classification_ledger_heads (
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 customer_domain TEXT NOT NULL,
 provider TEXT NOT NULL,
 canonical_account_id INTEGER NOT NULL,
 canonical_message_id TEXT NOT NULL,
 latest_generation INTEGER NOT NULL DEFAULT 0 CHECK(latest_generation >= 0),
 latest_event_id TEXT,
 latest_evidence_id TEXT,
 latest_entry_digest TEXT CHECK(latest_entry_digest IS NULL OR length(latest_entry_digest)=64),
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(tenant_id,workspace_id,customer_domain,provider,canonical_account_id,canonical_message_id),
 CHECK((latest_generation=0 AND latest_event_id IS NULL AND latest_evidence_id IS NULL AND latest_entry_digest IS NULL)
    OR (latest_generation>0 AND latest_event_id IS NOT NULL AND latest_evidence_id IS NOT NULL AND latest_entry_digest IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS nexora_domain_ownership_verification_events (
 id TEXT PRIMARY KEY,
 challenge_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 normalized_domain TEXT NOT NULL,
 generation INTEGER NOT NULL CHECK(generation > 0),
 verification_operation_id TEXT NOT NULL UNIQUE,
 authority_id TEXT,
 authority_generation INTEGER,
 verification_evidence_ref TEXT NOT NULL,
 actor_user_id INTEGER NOT NULL,
 auth_session_ref TEXT NOT NULL,
 hmac_key_version TEXT NOT NULL,
 request_id TEXT NOT NULL,
 runtime_deployment_id TEXT NOT NULL,
 acceptance_correlation_ref TEXT NOT NULL,
 result TEXT NOT NULL CHECK(result IN ('VERIFIED','FAILED','EXPIRED','REVOKED')),
 observed_at TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(challenge_id) REFERENCES nexora_domain_ownership_challenges(id),
 UNIQUE(tenant_id,workspace_id,normalized_domain,generation)
);
CREATE INDEX IF NOT EXISTS idx_nexora_domain_verification_correlation
 ON nexora_domain_ownership_verification_events(tenant_id,workspace_id,acceptance_correlation_ref,runtime_deployment_id,created_at);

CREATE TABLE IF NOT EXISTS nexora_runtime_acceptance_sessions (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 actor_user_id INTEGER NOT NULL,
 canonical_account_id INTEGER NOT NULL,
 platform TEXT NOT NULL CHECK(platform IN ('DESKTOP','IOS_PHYSICAL')),
 build_id TEXT NOT NULL,
 build_version TEXT NOT NULL,
 runtime_deployment_id TEXT NOT NULL,
 artifact_digest TEXT NOT NULL CHECK(length(artifact_digest)=64),
 source_commit TEXT NOT NULL,
 signing_identity TEXT NOT NULL,
 signing_key_version TEXT NOT NULL,
 allowlist_policy_version TEXT NOT NULL,
 attestation_ref TEXT,
 attestation_digest TEXT CHECK(attestation_digest IS NULL OR length(attestation_digest)=64),
 challenge_hash TEXT NOT NULL,
 auth_session_ref TEXT NOT NULL,
 hmac_key_version TEXT NOT NULL,
 request_id TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'ISSUED' CHECK(status IN ('ISSUED','CONSUMED','EXPIRED','REVOKED')),
 issued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 expires_at TEXT NOT NULL,
 consumed_at TEXT,
 consumed_request_id TEXT,
 UNIQUE(tenant_id,workspace_id,actor_user_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_nexora_runtime_acceptance_session_scope
 ON nexora_runtime_acceptance_sessions(tenant_id,workspace_id,actor_user_id,status,expires_at);

CREATE TABLE IF NOT EXISTS nexora_runtime_correlation_events (
 id TEXT PRIMARY KEY,
 acceptance_session_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 actor_user_id INTEGER NOT NULL,
 canonical_account_id INTEGER NOT NULL,
 classification_id TEXT NOT NULL,
 classification_evidence_ref TEXT NOT NULL,
 message_fingerprint TEXT NOT NULL,
 platform TEXT NOT NULL CHECK(platform IN ('DESKTOP','IOS_PHYSICAL')),
 build_id TEXT NOT NULL,
 build_version TEXT NOT NULL,
 runtime_deployment_id TEXT NOT NULL,
 artifact_digest TEXT NOT NULL CHECK(length(artifact_digest)=64),
 source_commit TEXT NOT NULL,
 signing_identity TEXT NOT NULL,
 signing_key_version TEXT NOT NULL,
 allowlist_policy_version TEXT NOT NULL,
 attestation_ref TEXT,
 attestation_digest TEXT CHECK(attestation_digest IS NULL OR length(attestation_digest)=64),
 auth_session_ref TEXT NOT NULL,
 hmac_key_version TEXT NOT NULL,
 request_id TEXT NOT NULL,
 event_type TEXT NOT NULL CHECK(event_type='CLASSIFICATION_OBSERVED'),
 authority_tuple_digest TEXT NOT NULL CHECK(length(authority_tuple_digest)=64),
 event_digest TEXT NOT NULL CHECK(length(event_digest)=64),
 occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(acceptance_session_id) REFERENCES nexora_runtime_acceptance_sessions(id),
 FOREIGN KEY(classification_id) REFERENCES nexora_email_classifications(id),
 UNIQUE(acceptance_session_id,event_type,classification_id)
);
CREATE INDEX IF NOT EXISTS idx_nexora_runtime_correlation_scope
 ON nexora_runtime_correlation_events(tenant_id,workspace_id,canonical_account_id,runtime_deployment_id,occurred_at);

CREATE TRIGGER IF NOT EXISTS trg_nexora_classification_runs_no_update BEFORE UPDATE ON nexora_classification_runs
 BEGIN SELECT RAISE(ABORT, 'nexora_evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_nexora_classification_runs_no_delete BEFORE DELETE ON nexora_classification_runs
 BEGIN SELECT RAISE(ABORT, 'nexora_evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_nexora_classification_events_no_update BEFORE UPDATE ON nexora_email_classification_events
 BEGIN SELECT RAISE(ABORT, 'nexora_evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_nexora_classification_events_no_delete BEFORE DELETE ON nexora_email_classification_events
 BEGIN SELECT RAISE(ABORT, 'nexora_evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_nexora_evidence_v2_no_update BEFORE UPDATE ON nexora_email_classification_evidence_v2
 BEGIN SELECT RAISE(ABORT, 'nexora_evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_nexora_evidence_v2_no_delete BEFORE DELETE ON nexora_email_classification_evidence_v2
 BEGIN SELECT RAISE(ABORT, 'nexora_evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_nexora_domain_verification_events_no_update BEFORE UPDATE ON nexora_domain_ownership_verification_events
 BEGIN SELECT RAISE(ABORT, 'nexora_evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_nexora_domain_verification_events_no_delete BEFORE DELETE ON nexora_domain_ownership_verification_events
 BEGIN SELECT RAISE(ABORT, 'nexora_evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_nexora_runtime_correlation_events_no_update BEFORE UPDATE ON nexora_runtime_correlation_events
 BEGIN SELECT RAISE(ABORT, 'nexora_evidence_append_only'); END;
CREATE TRIGGER IF NOT EXISTS trg_nexora_runtime_correlation_events_no_delete BEFORE DELETE ON nexora_runtime_correlation_events
 BEGIN SELECT RAISE(ABORT, 'nexora_evidence_append_only'); END;

CREATE TRIGGER IF NOT EXISTS trg_nexora_classification_event_scope_guard
 BEFORE INSERT ON nexora_email_classification_events
 WHEN NOT EXISTS (
  SELECT 1 FROM nexora_classification_runs r
  WHERE r.id=NEW.run_id AND r.tenant_id=NEW.tenant_id AND r.workspace_id=NEW.workspace_id
   AND r.canonical_account_id=NEW.canonical_account_id AND r.provider_account_hash=NEW.provider_account_hash
 )
 BEGIN SELECT RAISE(ABORT, 'nexora_classification_run_scope_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS trg_nexora_classification_evidence_linkage_guard
 BEFORE INSERT ON nexora_email_classification_evidence_v2
 WHEN NOT EXISTS (
  SELECT 1 FROM nexora_email_classification_events e
  WHERE e.id=NEW.event_id AND e.run_id=NEW.run_id AND e.classification_id=NEW.classification_id
   AND e.tenant_id=NEW.tenant_id AND e.workspace_id=NEW.workspace_id
   AND e.customer_domain=NEW.customer_domain AND e.provider=NEW.provider
   AND e.provider_account_hash=NEW.provider_account_hash AND e.canonical_account_id=NEW.canonical_account_id
   AND e.canonical_message_id=NEW.canonical_message_id AND e.message_fingerprint=NEW.message_fingerprint
   AND e.source_created_at=NEW.source_created_at AND e.provenance_ref=NEW.provenance_ref
   AND e.generation=NEW.generation AND e.evidence_id=NEW.id
   AND e.previous_entry_digest IS NEW.previous_entry_digest
 )
 BEGIN SELECT RAISE(ABORT, 'nexora_classification_evidence_linkage_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS trg_nexora_domain_verification_linkage_guard
 BEFORE INSERT ON nexora_domain_ownership_verification_events
 WHEN NOT EXISTS (
  SELECT 1 FROM nexora_domain_ownership_challenges c
  WHERE c.id=NEW.challenge_id AND c.tenant_id=NEW.tenant_id AND c.workspace_id=NEW.workspace_id
   AND c.normalized_domain=NEW.normalized_domain AND c.generation=NEW.generation
   AND c.verification_operation_id=NEW.verification_operation_id
 )
 BEGIN SELECT RAISE(ABORT, 'nexora_domain_verification_linkage_mismatch'); END;

CREATE TRIGGER IF NOT EXISTS trg_nexora_runtime_correlation_linkage_guard
 BEFORE INSERT ON nexora_runtime_correlation_events
 WHEN NOT EXISTS (
  SELECT 1 FROM nexora_runtime_acceptance_sessions s
  WHERE s.id=NEW.acceptance_session_id AND s.tenant_id=NEW.tenant_id AND s.workspace_id=NEW.workspace_id
   AND s.actor_user_id=NEW.actor_user_id AND s.canonical_account_id=NEW.canonical_account_id
   AND s.platform=NEW.platform AND s.build_id=NEW.build_id AND s.build_version=NEW.build_version
   AND s.runtime_deployment_id=NEW.runtime_deployment_id AND s.auth_session_ref=NEW.auth_session_ref
   AND s.hmac_key_version=NEW.hmac_key_version
   AND s.artifact_digest=NEW.artifact_digest AND s.source_commit=NEW.source_commit
   AND s.signing_identity=NEW.signing_identity AND s.signing_key_version=NEW.signing_key_version
   AND s.allowlist_policy_version=NEW.allowlist_policy_version
   AND s.attestation_ref IS NEW.attestation_ref AND s.attestation_digest IS NEW.attestation_digest
   AND s.status='CONSUMED' AND s.consumed_at IS NOT NULL
 )
 BEGIN SELECT RAISE(ABORT, 'nexora_runtime_correlation_linkage_mismatch'); END;
