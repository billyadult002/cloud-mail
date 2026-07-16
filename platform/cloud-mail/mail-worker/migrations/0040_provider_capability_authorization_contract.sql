-- Provider Capability and Authorization Contract P0; additive to Runtime/Evidence.
CREATE TABLE IF NOT EXISTS mission_runtime_provider_identities (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, account_id INTEGER NOT NULL, provider TEXT NOT NULL,
 provider_account_hash TEXT NOT NULL, acting_identity_hash TEXT NOT NULL, delegated_identity_hash TEXT, relationship TEXT NOT NULL,
 identity_status TEXT NOT NULL, authorization_generation INTEGER NOT NULL, observed_at TEXT NOT NULL, last_validated_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,provider,account_id,authorization_generation)
);
CREATE TABLE IF NOT EXISTS mission_runtime_provider_credentials (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, account_id INTEGER NOT NULL, provider TEXT NOT NULL,
 credential_reference_hash TEXT NOT NULL, authorization_generation INTEGER NOT NULL, status TEXT NOT NULL,
 observed_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,provider,account_id,authorization_generation)
);
CREATE TABLE IF NOT EXISTS mission_runtime_provider_authorities (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, account_id INTEGER NOT NULL, provider TEXT NOT NULL,
 acting_identity_hash TEXT NOT NULL, delegated_identity_hash TEXT, action_classes_json TEXT NOT NULL, authorization_generation INTEGER NOT NULL,
 status TEXT NOT NULL, source_type TEXT NOT NULL, observed_at TEXT NOT NULL, expires_at TEXT, evidence_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS mission_runtime_provider_capabilities (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, account_id INTEGER NOT NULL, provider TEXT NOT NULL,
 capability_key TEXT NOT NULL, capability_version INTEGER NOT NULL, status TEXT NOT NULL, risk_level TEXT NOT NULL, freshness_seconds INTEGER NOT NULL,
 authority_class TEXT NOT NULL, credential_condition TEXT NOT NULL, adapter_version TEXT NOT NULL, observed_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 limitations_json TEXT NOT NULL DEFAULT '{}', evidence_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,account_id,provider,capability_key,capability_version,observed_at)
);
CREATE TABLE IF NOT EXISTS mission_runtime_action_requirements (
 id TEXT NOT NULL, version INTEGER NOT NULL, action_type TEXT NOT NULL, required_capabilities_json TEXT NOT NULL, required_authority_json TEXT NOT NULL,
 approval_required INTEGER NOT NULL, policy_required INTEGER NOT NULL, risk_level TEXT NOT NULL, verification_required INTEGER NOT NULL, allow_degraded INTEGER NOT NULL DEFAULT 0,
 blocked_state TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(id,version)
);
CREATE TABLE IF NOT EXISTS mission_runtime_provider_decisions (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, mission_id TEXT, run_id TEXT, action_id TEXT,
 provider TEXT NOT NULL, account_id INTEGER NOT NULL, acting_identity_hash TEXT NOT NULL, delegated_identity_hash TEXT,
 requirement_id TEXT NOT NULL, requirement_version INTEGER NOT NULL, params_hash TEXT NOT NULL, authorization_generation INTEGER NOT NULL,
 credential_reference_hash TEXT NOT NULL, result TEXT NOT NULL, reason_codes_json TEXT NOT NULL, evidence_set_hash TEXT NOT NULL,
 adapter_version TEXT NOT NULL, runtime_version INTEGER, fencing_token INTEGER, decided_at TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_runtime_provider_decisions_scope ON mission_runtime_provider_decisions(tenant_id,workspace_id,action_id,expires_at);
