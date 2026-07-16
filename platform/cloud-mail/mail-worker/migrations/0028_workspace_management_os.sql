-- GPT68: workspace is the management authority for every custom domain.
CREATE TABLE IF NOT EXISTS workspaces (
 id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_key TEXT NOT NULL, display_name TEXT NOT NULL,
 created_by_user_id INTEGER NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_key, display_name)
);
CREATE TABLE IF NOT EXISTS workspace_members (
 workspace_id INTEGER NOT NULL, user_id INTEGER NOT NULL, role TEXT NOT NULL CHECK(role IN ('OWNER','ADMIN','SECURITY_ADMIN','MAIL_ADMIN','VIEWER','SUPPORT')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(workspace_id,user_id), FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS workspace_domains (
 id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL, domain TEXT NOT NULL COLLATE NOCASE, provider TEXT NOT NULL DEFAULT 'custom',
 authority_state TEXT NOT NULL DEFAULT 'AUTHORITY_REQUIRED', lifecycle_state TEXT NOT NULL DEFAULT 'DISCOVERED', health_state TEXT NOT NULL DEFAULT 'NEEDS_ATTENTION',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(domain), FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS workspace_identities (
 id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL, local_part TEXT NOT NULL, domain_id INTEGER NOT NULL, lifecycle_state TEXT NOT NULL DEFAULT 'DISCOVERED',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(workspace_id,local_part,domain_id), FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE, FOREIGN KEY(domain_id) REFERENCES workspace_domains(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS workspace_mailboxes (
 id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL, identity_id INTEGER NOT NULL UNIQUE, account_id INTEGER, lifecycle_state TEXT NOT NULL DEFAULT 'DISCOVERED',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE, FOREIGN KEY(identity_id) REFERENCES workspace_identities(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS workspace_aliases (
 id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL, alias_email TEXT NOT NULL COLLATE NOCASE, identity_id INTEGER, mailbox_id INTEGER,
 provider TEXT NOT NULL DEFAULT 'custom', lifecycle_state TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(alias_email), FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS workspace_provider_grants (
 id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL, provider TEXT NOT NULL, authority_state TEXT NOT NULL DEFAULT 'AUTHORIZATION_REQUIRED',
 expires_at TEXT, credential_ref TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(workspace_id,provider), FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS workspace_provisioning_jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL, domain_id INTEGER, mailbox_id INTEGER, job_type TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'QUEUED',
 blocker_code TEXT, request_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS workspace_audit_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, workspace_id INTEGER NOT NULL, actor_user_id INTEGER NOT NULL, action TEXT NOT NULL, object_type TEXT NOT NULL, object_ref TEXT,
 before_state_json TEXT NOT NULL DEFAULT '{}', after_state_json TEXT NOT NULL DEFAULT '{}', request_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY(workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_workspace_domains_workspace ON workspace_domains(workspace_id,domain);
CREATE INDEX IF NOT EXISTS idx_workspace_audit_workspace_created ON workspace_audit_events(workspace_id,created_at);
