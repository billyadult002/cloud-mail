-- NEXORA domain ownership validation.
-- Stores bodyless DNS challenge state for any-domain ownership proof. This
-- table must not store provider tokens, OAuth state, PKCE verifiers, session
-- cookies, raw provider payloads, private keys, or email bodies.

CREATE TABLE IF NOT EXISTS nexora_domain_ownership_challenges (
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 normalized_domain TEXT NOT NULL,
 challenge_name TEXT NOT NULL,
 challenge_token_hash TEXT NOT NULL,
 verification_method TEXT NOT NULL DEFAULT 'DNS_TXT',
 verification_status TEXT NOT NULL CHECK(verification_status IN ('pending','verified','expired','failed','revoked')),
 verification_evidence_ref TEXT,
 administrator_authority_ref TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 attempt INTEGER NOT NULL DEFAULT 0,
 expires_at TEXT NOT NULL,
 verified_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,normalized_domain,idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_nexora_domain_ownership_challenges_scope ON nexora_domain_ownership_challenges(tenant_id,workspace_id,normalized_domain,verification_status);
