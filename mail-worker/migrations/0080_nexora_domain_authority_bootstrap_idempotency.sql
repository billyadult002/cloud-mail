-- Exactly-once Domain Authority bootstrap operations. Existing authority and
-- audit rows remain valid; new bootstrap audits are linked to one operation.

CREATE TABLE IF NOT EXISTS nexora_domain_authority_bootstrap_operations (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 normalized_domain TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
 actor_user_id INTEGER,
 ownership_event_id TEXT NOT NULL,
 ownership_generation INTEGER NOT NULL CHECK(ownership_generation>0),
 verification_evidence_ref TEXT NOT NULL,
 authority_id TEXT NOT NULL,
 authority_generation INTEGER NOT NULL CHECK(authority_generation>0),
 result_mode TEXT NOT NULL CHECK(result_mode IN ('CREATED','REFRESHED','LEGACY_ADOPTED')),
 status TEXT NOT NULL CHECK(status='COMPLETED'),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,normalized_domain,idempotency_key),
 UNIQUE(tenant_id,workspace_id,normalized_domain,ownership_event_id)
);

CREATE INDEX IF NOT EXISTS idx_nexora_bootstrap_operations_authority
 ON nexora_domain_authority_bootstrap_operations(authority_id,authority_generation);

ALTER TABLE nexora_audit_events ADD COLUMN operation_id TEXT;
ALTER TABLE workspace_audit_events ADD COLUMN operation_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS uq_nexora_authority_bootstrap_audit_operation
 ON nexora_audit_events(operation_id)
 WHERE operation_id IS NOT NULL AND action='NEXORA_DOMAIN_AUTHORITY_BOOTSTRAPPED';

CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_authority_bootstrap_audit_operation
 ON workspace_audit_events(operation_id)
 WHERE operation_id IS NOT NULL AND action='NEXORA_DOMAIN_AUTHORITY_BOOTSTRAPPED';
