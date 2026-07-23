-- Schema-only fixture for the exact staging email/UCS drift. No mailbox or customer rows.
CREATE TABLE d1_migrations(
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 name TEXT NOT NULL UNIQUE,
 applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO d1_migrations(name) VALUES('0081_nexora_durable_connection_runtime.sql');

CREATE TABLE email(
 email_id INTEGER NOT NULL PRIMARY KEY,
 send_email TEXT,
 name TEXT,
 account_id INTEGER NOT NULL,
 user_id INTEGER NOT NULL,
 subject TEXT,
 content TEXT,
 text TEXT,
 message_id TEXT DEFAULT '',
 in_reply_to TEXT DEFAULT '',
 to_email TEXT DEFAULT '',
 status INTEGER NOT NULL DEFAULT 0,
 type INTEGER NOT NULL DEFAULT 0,
 create_time DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 is_del INTEGER NOT NULL DEFAULT 0,
 provider TEXT NOT NULL DEFAULT 'cloudflare_native',
 account_email TEXT NOT NULL DEFAULT '',
 account_domain TEXT NOT NULL DEFAULT '',
 thread_id TEXT NOT NULL DEFAULT '',
 external_message_id TEXT NOT NULL DEFAULT '',
 folder_key TEXT NOT NULL DEFAULT 'inbox'
);

CREATE TABLE workspace_account_bindings(
 workspace_id INTEGER NOT NULL,
 account_id INTEGER NOT NULL,
 subject_user_id INTEGER NOT NULL,
 lifecycle_state TEXT NOT NULL
);

CREATE TABLE conversation_ingest_outbox(
 id TEXT PRIMARY KEY,
 tenant_id INTEGER NOT NULL,
 workspace_id INTEGER NOT NULL,
 account_id INTEGER NOT NULL,
 source_message_id INTEGER NOT NULL,
 source_version TEXT NOT NULL,
 event_type TEXT NOT NULL,
 UNIQUE(tenant_id,workspace_id,source_message_id,source_version,event_type)
);

CREATE TRIGGER ucs_email_updated_outbox AFTER UPDATE OF subject,content,text,unread,is_del,status ON email
BEGIN
 INSERT OR IGNORE INTO conversation_ingest_outbox(id,tenant_id,workspace_id,account_id,source_message_id,source_version,event_type)
 SELECT 'ucs-update:'||wb.subject_user_id||':'||wb.workspace_id||':'||NEW.email_id||':'||NEW.unread||':'||NEW.is_del||':'||NEW.status||':'||length(COALESCE(NEW.text,NEW.content,'')),
        wb.subject_user_id,wb.workspace_id,NEW.account_id,NEW.email_id,
        NEW.unread||':'||NEW.is_del||':'||NEW.status||':'||length(COALESCE(NEW.text,NEW.content,'')),'updated'
 FROM workspace_account_bindings wb
 WHERE wb.account_id=NEW.account_id AND wb.lifecycle_state='READY';
END;
