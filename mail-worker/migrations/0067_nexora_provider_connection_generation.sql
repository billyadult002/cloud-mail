-- Explicit generation authority for provider-connection lineage. Additive successor to 0066.
CREATE TABLE IF NOT EXISTS nexora_onboarding_provider_connections (
 id TEXT PRIMARY KEY,
 onboarding_mission_id TEXT NOT NULL,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
 connection_identity TEXT NOT NULL,
 generation INTEGER NOT NULL DEFAULT 1,
 connection_state TEXT NOT NULL DEFAULT 'active',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,provider,connection_identity)
);
CREATE INDEX IF NOT EXISTS idx_nexora_provider_connection_scope ON nexora_onboarding_provider_connections(tenant_id,workspace_id,provider);
