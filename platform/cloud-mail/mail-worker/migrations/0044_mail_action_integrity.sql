CREATE TABLE IF NOT EXISTS mail_canonical_state (
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 account_id INTEGER NOT NULL,
 message_id INTEGER NOT NULL,
 thread_id TEXT NOT NULL DEFAULT '',
 provider_message_id TEXT NOT NULL DEFAULT '',
 semantic_category TEXT NOT NULL DEFAULT 'general',
 priority_state TEXT NOT NULL DEFAULT 'automatic',
 is_priority INTEGER NOT NULL DEFAULT 0,
 is_vip INTEGER NOT NULL DEFAULT 0,
 junk_disposition TEXT NOT NULL DEFAULT 'not_junk',
 is_starred INTEGER NOT NULL DEFAULT 0,
 is_read INTEGER NOT NULL DEFAULT 0,
 folder_key TEXT NOT NULL DEFAULT 'inbox',
 overlays_json TEXT NOT NULL DEFAULT '[]',
 tags_json TEXT NOT NULL DEFAULT '[]',
 last_mutation_id TEXT,
 state_version INTEGER NOT NULL DEFAULT 1,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (tenant_id,workspace_id,account_id,message_id)
);
CREATE TABLE IF NOT EXISTS mail_manual_overrides (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 account_id INTEGER NOT NULL, message_id INTEGER NOT NULL, thread_id TEXT NOT NULL DEFAULT '',
 scope TEXT NOT NULL CHECK(scope IN ('message','thread','template','sender')),
 field_key TEXT NOT NULL, value_json TEXT NOT NULL, template_fingerprint TEXT,
 sender_hash TEXT, generation INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1,
 reason_code TEXT NOT NULL, actor_user_id INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, revoked_at TEXT
);
CREATE TABLE IF NOT EXISTS mail_action_receipts (
 id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL, tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL, account_id INTEGER NOT NULL, message_id INTEGER NOT NULL,
 action TEXT NOT NULL, request_version INTEGER NOT NULL, result_version INTEGER NOT NULL,
 request_hash TEXT NOT NULL, result_json TEXT NOT NULL, actor_user_id INTEGER NOT NULL,
 source_surface TEXT NOT NULL DEFAULT 'unknown', provider_operation TEXT NOT NULL DEFAULT 'none',
 status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','failed','recoverable')),
 reason_code TEXT NOT NULL DEFAULT 'mutation_committed', audit_reference TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id,workspace_id,idempotency_key)
);
CREATE TABLE IF NOT EXISTS mail_mutation_authorizations (
 id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 account_id INTEGER NOT NULL, message_id INTEGER NOT NULL, expected_version INTEGER NOT NULL,
 request_hash TEXT NOT NULL, expires_at TEXT NOT NULL, consumed_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_mail_state_surface ON mail_canonical_state(tenant_id,workspace_id,semantic_category,is_priority,is_vip,junk_disposition,is_starred,folder_key);
CREATE INDEX IF NOT EXISTS idx_mail_override_target ON mail_manual_overrides(tenant_id,workspace_id,account_id,message_id,active,generation);
CREATE TRIGGER IF NOT EXISTS mail_receipt_no_update BEFORE UPDATE ON mail_action_receipts BEGIN SELECT RAISE(ABORT,'mail_action_receipt_append_only'); END;
CREATE TRIGGER IF NOT EXISTS mail_receipt_no_delete BEFORE DELETE ON mail_action_receipts BEGIN SELECT RAISE(ABORT,'mail_action_receipt_append_only'); END;
CREATE TRIGGER IF NOT EXISTS mail_receipt_requires_state BEFORE INSERT ON mail_action_receipts
WHEN NOT EXISTS (SELECT 1 FROM mail_canonical_state s WHERE s.tenant_id=NEW.tenant_id AND s.workspace_id=NEW.workspace_id AND s.account_id=NEW.account_id AND s.message_id=NEW.message_id AND s.state_version=NEW.result_version AND s.last_mutation_id=NEW.id)
BEGIN SELECT RAISE(ABORT,'mail_receipt_without_authoritative_state'); END;
CREATE TRIGGER IF NOT EXISTS mail_state_authorized_update BEFORE UPDATE ON mail_canonical_state
WHEN NEW.state_version != OLD.state_version + 1 OR NEW.last_mutation_id IS NULL OR NOT EXISTS (
 SELECT 1 FROM mail_mutation_authorizations a WHERE a.id=NEW.last_mutation_id
 AND a.tenant_id=OLD.tenant_id AND a.workspace_id=OLD.workspace_id
 AND a.account_id=OLD.account_id AND a.message_id=OLD.message_id
 AND a.expected_version=OLD.state_version AND a.consumed_at IS NULL AND a.expires_at>CURRENT_TIMESTAMP)
BEGIN SELECT RAISE(ABORT,'mail_mutation_authorization_required'); END;
CREATE TRIGGER IF NOT EXISTS mail_override_no_delete BEFORE DELETE ON mail_manual_overrides BEGIN SELECT RAISE(ABORT,'mail_override_history_append_only'); END;
