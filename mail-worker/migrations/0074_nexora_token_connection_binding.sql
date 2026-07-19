-- Canonical token-to-Provider-connection binding used by callback finalization.
CREATE TABLE IF NOT EXISTS nexora_onboarding_token_connection_bindings (
 token_id TEXT PRIMARY KEY,
 connection_id TEXT NOT NULL UNIQUE,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 provider TEXT NOT NULL,
 token_generation INTEGER NOT NULL,
 connection_generation INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(connection_id) REFERENCES nexora_onboarding_provider_connections(id)
);
CREATE INDEX IF NOT EXISTS idx_nexora_token_connection_binding_scope ON nexora_onboarding_token_connection_bindings(tenant_id,workspace_id,provider);
