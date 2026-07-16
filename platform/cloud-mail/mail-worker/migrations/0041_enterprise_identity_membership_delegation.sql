-- Enterprise identity, membership and account delegation control plane P0.
CREATE TABLE IF NOT EXISTS workspace_membership_invitations (
 id TEXT PRIMARY KEY, tenant_key TEXT NOT NULL, workspace_id INTEGER NOT NULL, requester_user_id INTEGER NOT NULL,
 subject_user_id INTEGER NOT NULL, role TEXT NOT NULL, scope_json TEXT NOT NULL, reason TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE, state TEXT NOT NULL, review_id TEXT, approved_by_user_id INTEGER,
 issued_at TEXT, accepted_at TEXT, expires_at TEXT NOT NULL, revoked_at TEXT, version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(workspace_id,subject_user_id,state)
);
CREATE TABLE IF NOT EXISTS workspace_membership_authorities (
 id TEXT PRIMARY KEY, tenant_key TEXT NOT NULL, workspace_id INTEGER NOT NULL, subject_user_id INTEGER NOT NULL,
 granting_user_id INTEGER NOT NULL, invitation_id TEXT NOT NULL, role TEXT NOT NULL, scope_json TEXT NOT NULL,
 state TEXT NOT NULL, authority_generation INTEGER NOT NULL, activated_at TEXT, expires_at TEXT,
 suspended_at TEXT, revoked_at TEXT, reason TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(workspace_id,subject_user_id,authority_generation)
);
CREATE TABLE IF NOT EXISTS workspace_account_delegations (
 id TEXT PRIMARY KEY, tenant_key TEXT NOT NULL, workspace_id INTEGER NOT NULL, account_id INTEGER NOT NULL,
 owner_user_id INTEGER NOT NULL, subject_user_id INTEGER NOT NULL, requester_user_id INTEGER NOT NULL,
 scope_json TEXT NOT NULL, reason TEXT NOT NULL, state TEXT NOT NULL, owner_consent_at TEXT,
 owner_consent_by_user_id INTEGER, approved_at TEXT, approved_by_user_id INTEGER, activated_at TEXT,
 expires_at TEXT NOT NULL, suspended_at TEXT, revoked_at TEXT, authority_generation INTEGER NOT NULL DEFAULT 1,
 version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(workspace_id,account_id,subject_user_id,authority_generation)
);
CREATE TABLE IF NOT EXISTS workspace_authority_events (
 id TEXT PRIMARY KEY, tenant_key TEXT NOT NULL, workspace_id INTEGER NOT NULL, actor_user_id INTEGER NOT NULL,
 subject_user_id INTEGER, account_id INTEGER, relationship_type TEXT NOT NULL, relationship_id TEXT NOT NULL,
 event_type TEXT NOT NULL, state TEXT NOT NULL, scope_hash TEXT NOT NULL, authority_generation INTEGER NOT NULL,
 reason_code TEXT NOT NULL, request_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_membership_authority_active ON workspace_membership_authorities(workspace_id,subject_user_id,state,expires_at);
CREATE INDEX IF NOT EXISTS idx_account_delegation_active ON workspace_account_delegations(workspace_id,account_id,subject_user_id,state,expires_at);
CREATE INDEX IF NOT EXISTS idx_authority_events_scope ON workspace_authority_events(workspace_id,relationship_type,relationship_id,created_at);
