-- Additive NEXORA V3 authority, identity, privacy, calendar, and autonomy state.
CREATE TABLE IF NOT EXISTS nexora_provider_authorizations (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, provider TEXT NOT NULL, subject_ref TEXT NOT NULL,
 credential_ref TEXT, requested_scopes_json TEXT NOT NULL DEFAULT '[]', granted_scopes_json TEXT NOT NULL DEFAULT '[]',
 authority_state TEXT NOT NULL CHECK(authority_state IN ('AUTHORIZED','PARTIALLY_AUTHORIZED','AUTHORIZATION_REQUIRED','UNSUPPORTED')),
 consented_at TEXT, expires_at TEXT, revoked_at TEXT, last_verified_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id,provider,subject_ref)
);
CREATE TABLE IF NOT EXISTS nexora_authority_evidence (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, provider TEXT NOT NULL, subject_ref TEXT NOT NULL,
 capability_key TEXT NOT NULL, requested INTEGER NOT NULL DEFAULT 0, granted INTEGER NOT NULL DEFAULT 0,
 ownership_verified INTEGER NOT NULL DEFAULT 0, probe_state TEXT NOT NULL DEFAULT 'NOT_PROBED', evidence_json TEXT NOT NULL DEFAULT '{}',
 observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id,provider,subject_ref,capability_key)
);
CREATE TABLE IF NOT EXISTS nexora_domain_connections (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, email TEXT NOT NULL COLLATE NOCASE, domain TEXT NOT NULL COLLATE NOCASE,
 provider TEXT NOT NULL DEFAULT 'custom', ownership_state TEXT NOT NULL CHECK(ownership_state IN ('UNVERIFIED','VERIFIED','REVOKED')) DEFAULT 'UNVERIFIED', lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN ('DISCOVERING','CONFIGURING','VALIDATING','REPAIRING','READY','NEEDS_ATTENTION','BLOCKED')) DEFAULT 'DISCOVERING',
 authority_state TEXT NOT NULL DEFAULT 'AUTHORIZATION_REQUIRED', desired_state_json TEXT NOT NULL DEFAULT '{}', observed_state_json TEXT NOT NULL DEFAULT '{}',
 blocker_json TEXT NOT NULL DEFAULT '[]', last_validated_at TEXT, last_monitor_attempt_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id,domain)
);
CREATE TABLE IF NOT EXISTS nexora_identity_workspaces (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, workspace_key TEXT NOT NULL, display_name TEXT NOT NULL,
 isolation_policy_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id,workspace_key)
);
CREATE TABLE IF NOT EXISTS nexora_aliases (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, workspace_key TEXT NOT NULL, alias_email TEXT NOT NULL COLLATE NOCASE,
 provider TEXT NOT NULL, lifecycle_state TEXT NOT NULL CHECK(lifecycle_state IN ('ACTIVE','ROTATED','DISABLED','ARCHIVED')) DEFAULT 'ACTIVE',
 routes_to_ref TEXT, provider_ref TEXT, last_validated_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id,alias_email), FOREIGN KEY(user_id,workspace_key) REFERENCES nexora_identity_workspaces(user_id,workspace_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS nexora_privacy_findings (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, internal_message_id TEXT NOT NULL, finding_type TEXT NOT NULL,
 risk_level TEXT NOT NULL, blocked INTEGER NOT NULL DEFAULT 1, evidence_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nexora_privacy_message ON nexora_privacy_findings(user_id,internal_message_id);
CREATE TABLE IF NOT EXISTS nexora_calendar_connections (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, workspace_key TEXT NOT NULL, provider TEXT NOT NULL, calendar_ref TEXT NOT NULL,
 authority_state TEXT NOT NULL, credential_ref TEXT, sync_cursor TEXT, last_synced_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id,workspace_key,provider,calendar_ref),
 FOREIGN KEY(user_id,workspace_key) REFERENCES nexora_identity_workspaces(user_id,workspace_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS nexora_agenda_items (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, workspace_key TEXT NOT NULL, source_provider TEXT NOT NULL, source_type TEXT NOT NULL, source_ref TEXT NOT NULL,
 item_type TEXT NOT NULL, title TEXT NOT NULL, starts_at TEXT, due_at TEXT, confidence REAL NOT NULL DEFAULT 0,
 write_state TEXT NOT NULL DEFAULT 'SUGGESTED', evidence_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(user_id,workspace_key,source_provider,source_type,source_ref,item_type),
 FOREIGN KEY(user_id,workspace_key) REFERENCES nexora_identity_workspaces(user_id,workspace_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS nexora_graph_nodes (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, tenant_key TEXT NOT NULL, workspace_key TEXT NOT NULL, graph_type TEXT NOT NULL CHECK(graph_type IN ('ORGANIZATION','IDENTITY')),
 node_key TEXT NOT NULL, node_type TEXT NOT NULL, display_name TEXT NOT NULL, source_provider TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '{}',
 last_observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id,tenant_key,workspace_key,graph_type,node_key),
 FOREIGN KEY(user_id,workspace_key) REFERENCES nexora_identity_workspaces(user_id,workspace_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS nexora_graph_edges (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, tenant_key TEXT NOT NULL, workspace_key TEXT NOT NULL, graph_type TEXT NOT NULL CHECK(graph_type IN ('ORGANIZATION','IDENTITY')),
 from_key TEXT NOT NULL, to_key TEXT NOT NULL, relationship TEXT NOT NULL, evidence_json TEXT NOT NULL DEFAULT '{}',
 last_observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(user_id,tenant_key,workspace_key,graph_type,from_key,to_key,relationship),
 FOREIGN KEY(user_id,workspace_key) REFERENCES nexora_identity_workspaces(user_id,workspace_key) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS nexora_autonomy_jobs (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, domain TEXT COLLATE NOCASE, job_type TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
 state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','RETRYING','SUCCEEDED','BLOCKED','FAILED')) DEFAULT 'QUEUED', attempt_count INTEGER NOT NULL DEFAULT 0,
 lease_until TEXT, input_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}', blocker_code TEXT, next_attempt_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nexora_jobs_due ON nexora_autonomy_jobs(state,next_attempt_at,lease_until);
CREATE TABLE IF NOT EXISTS nexora_health_snapshots (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, domain TEXT COLLATE NOCASE,
 overall_state TEXT NOT NULL CHECK(overall_state IN ('HEALTHY','REPAIRING','NEEDS_ATTENTION','BLOCKED')),
 dimensions_json TEXT NOT NULL DEFAULT '{}', blockers_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS nexora_audit_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, domain TEXT COLLATE NOCASE, action TEXT NOT NULL, object_type TEXT NOT NULL,
 object_ref TEXT, outcome TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nexora_audit_user_created ON nexora_audit_events(user_id,created_at);
CREATE TABLE IF NOT EXISTS nexora_notification_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, domain TEXT COLLATE NOCASE, notification_type TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('PENDING','DELIVERED','RESOLVED')) DEFAULT 'PENDING', message TEXT NOT NULL,
 metadata_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_nexora_notifications_pending ON nexora_notification_events(state,user_id,created_at);
