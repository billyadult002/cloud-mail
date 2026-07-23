-- Identifier: nexora-staging-email-unread-compatibility-v1
-- Contract SHA-256: ff7f08a4c78ee94fbfd020080ecbd27dfe0475c943e8623641c8dc52fbbcc7c1
-- Target: cloud-mail-staging / acf160ae-4efd-48d0-9d1b-7500f4cd0f41
--
-- Wrangler D1 migrations execute each migration transactionally and add the
-- filename to d1_migrations only after success. The guard tables deliberately
-- fail the transaction on any unreviewed staging drift.

CREATE TABLE IF NOT EXISTS nexora_schema_compatibility_remediations (
 identifier TEXT PRIMARY KEY,
 contract_sha256 TEXT NOT NULL UNIQUE CHECK(length(contract_sha256)=64),
 database_id TEXT NOT NULL,
 schema_before_sha256 TEXT NOT NULL CHECK(length(schema_before_sha256)=64),
 schema_after_sha256 TEXT NOT NULL CHECK(length(schema_after_sha256)=64),
 trigger_before_sha256 TEXT NOT NULL CHECK(length(trigger_before_sha256)=64),
 trigger_after_sha256 TEXT NOT NULL CHECK(length(trigger_after_sha256)=64),
 email_rows_before INTEGER NOT NULL CHECK(email_rows_before=0),
 outbox_rows_before INTEGER NOT NULL CHECK(outbox_rows_before=0),
 ready_bindings_before INTEGER NOT NULL CHECK(ready_bindings_before=0),
 completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE nexora_staging_email_unread_guard_v1 (
 ok INTEGER NOT NULL CHECK(ok=1)
);

INSERT INTO nexora_staging_email_unread_guard_v1(ok)
SELECT CASE WHEN
 (SELECT COUNT(*) FROM d1_migrations WHERE name='0081_nexora_durable_connection_runtime.sql')=1
 AND (SELECT COUNT(*) FROM d1_migrations WHERE name='0082_nexora_connection_owner_authority.sql')=0
 AND (SELECT COUNT(*) FROM d1_migrations WHERE name='0083_nexora_connection_expired_mission_rebind.sql')=0
 AND (SELECT COUNT(*) FROM d1_migrations WHERE name='0084_nexora_oauth_confidential_exchange_recovery.sql')=0
 AND (SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name IN (
  'nexora_connections_v2','nexora_connection_operations_v2','nexora_connection_events_v2'
 ))=0
 AND (SELECT COUNT(*) FROM email)=0
 AND (SELECT COUNT(*) FROM conversation_ingest_outbox)=0
 AND (SELECT COUNT(*) FROM workspace_account_bindings WHERE lifecycle_state='READY')=0
 AND (SELECT COUNT(*) FROM nexora_schema_compatibility_remediations
      WHERE identifier='nexora-staging-email-unread-compatibility-v1')=0
 AND (
  SELECT group_concat(name||':'||type||':'||"notnull"||':'||COALESCE(dflt_value,'NULL')||':'||pk,'|')
  FROM (SELECT name,type,"notnull",dflt_value,pk FROM pragma_table_info('email') ORDER BY cid)
 )='email_id:INTEGER:1:NULL:1|send_email:TEXT:0:NULL:0|name:TEXT:0:NULL:0|account_id:INTEGER:1:NULL:0|user_id:INTEGER:1:NULL:0|subject:TEXT:0:NULL:0|content:TEXT:0:NULL:0|text:TEXT:0:NULL:0|message_id:TEXT:0:'''':0|in_reply_to:TEXT:0:'''':0|to_email:TEXT:0:'''':0|status:INTEGER:1:0:0|type:INTEGER:1:0:0|create_time:DATETIME:1:CURRENT_TIMESTAMP:0|is_del:INTEGER:1:0:0|provider:TEXT:1:''cloudflare_native'':0|account_email:TEXT:1:'''':0|account_domain:TEXT:1:'''':0|thread_id:TEXT:1:'''':0|external_message_id:TEXT:1:'''':0|folder_key:TEXT:1:''inbox'':0'
 AND (SELECT sql FROM sqlite_master WHERE type='trigger' AND name='ucs_email_updated_outbox')=
 'CREATE TRIGGER ucs_email_updated_outbox AFTER UPDATE OF subject,content,text,unread,is_del,status ON email
BEGIN
 INSERT OR IGNORE INTO conversation_ingest_outbox(id,tenant_id,workspace_id,account_id,source_message_id,source_version,event_type)
 SELECT ''ucs-update:''||wb.subject_user_id||'':''||wb.workspace_id||'':''||NEW.email_id||'':''||NEW.unread||'':''||NEW.is_del||'':''||NEW.status||'':''||length(COALESCE(NEW.text,NEW.content,'''')),
        wb.subject_user_id,wb.workspace_id,NEW.account_id,NEW.email_id,
        NEW.unread||'':''||NEW.is_del||'':''||NEW.status||'':''||length(COALESCE(NEW.text,NEW.content,'''')),''updated''
 FROM workspace_account_bindings wb
 WHERE wb.account_id=NEW.account_id AND wb.lifecycle_state=''READY'';
END'
 THEN 1 ELSE 0 END;

DROP TRIGGER ucs_email_updated_outbox;
ALTER TABLE email ADD COLUMN unread INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER ucs_email_updated_outbox AFTER UPDATE OF subject,content,text,unread,is_del,status ON email
BEGIN
 INSERT OR IGNORE INTO conversation_ingest_outbox(id,tenant_id,workspace_id,account_id,source_message_id,source_version,event_type)
 SELECT 'ucs-update:'||wb.subject_user_id||':'||wb.workspace_id||':'||NEW.email_id||':'||NEW.unread||':'||NEW.is_del||':'||NEW.status||':'||length(COALESCE(NEW.text,NEW.content,'')),
        wb.subject_user_id,wb.workspace_id,NEW.account_id,NEW.email_id,
        NEW.unread||':'||NEW.is_del||':'||NEW.status||':'||length(COALESCE(NEW.text,NEW.content,'')),'updated'
 FROM workspace_account_bindings wb
 WHERE wb.account_id=NEW.account_id AND wb.lifecycle_state='READY';
END;

CREATE TABLE nexora_staging_email_unread_post_guard_v1 (
 ok INTEGER NOT NULL CHECK(ok=1)
);

INSERT INTO nexora_staging_email_unread_post_guard_v1(ok)
SELECT CASE WHEN
 (SELECT COUNT(*) FROM email)=0
 AND (SELECT COUNT(*) FROM conversation_ingest_outbox)=0
 AND (
  SELECT group_concat(name||':'||type||':'||"notnull"||':'||COALESCE(dflt_value,'NULL')||':'||pk,'|')
  FROM (SELECT name,type,"notnull",dflt_value,pk FROM pragma_table_info('email') ORDER BY cid)
 )='email_id:INTEGER:1:NULL:1|send_email:TEXT:0:NULL:0|name:TEXT:0:NULL:0|account_id:INTEGER:1:NULL:0|user_id:INTEGER:1:NULL:0|subject:TEXT:0:NULL:0|content:TEXT:0:NULL:0|text:TEXT:0:NULL:0|message_id:TEXT:0:'''':0|in_reply_to:TEXT:0:'''':0|to_email:TEXT:0:'''':0|status:INTEGER:1:0:0|type:INTEGER:1:0:0|create_time:DATETIME:1:CURRENT_TIMESTAMP:0|is_del:INTEGER:1:0:0|provider:TEXT:1:''cloudflare_native'':0|account_email:TEXT:1:'''':0|account_domain:TEXT:1:'''':0|thread_id:TEXT:1:'''':0|external_message_id:TEXT:1:'''':0|folder_key:TEXT:1:''inbox'':0|unread:INTEGER:1:0:0'
 AND (SELECT sql FROM sqlite_master WHERE type='trigger' AND name='ucs_email_updated_outbox')=
 'CREATE TRIGGER ucs_email_updated_outbox AFTER UPDATE OF subject,content,text,unread,is_del,status ON email
BEGIN
 INSERT OR IGNORE INTO conversation_ingest_outbox(id,tenant_id,workspace_id,account_id,source_message_id,source_version,event_type)
 SELECT ''ucs-update:''||wb.subject_user_id||'':''||wb.workspace_id||'':''||NEW.email_id||'':''||NEW.unread||'':''||NEW.is_del||'':''||NEW.status||'':''||length(COALESCE(NEW.text,NEW.content,'''')),
        wb.subject_user_id,wb.workspace_id,NEW.account_id,NEW.email_id,
        NEW.unread||'':''||NEW.is_del||'':''||NEW.status||'':''||length(COALESCE(NEW.text,NEW.content,'''')),''updated''
 FROM workspace_account_bindings wb
 WHERE wb.account_id=NEW.account_id AND wb.lifecycle_state=''READY'';
END'
 THEN 1 ELSE 0 END;

INSERT INTO nexora_schema_compatibility_remediations(
 identifier,contract_sha256,database_id,schema_before_sha256,schema_after_sha256,
 trigger_before_sha256,trigger_after_sha256,email_rows_before,outbox_rows_before,ready_bindings_before
) VALUES(
 'nexora-staging-email-unread-compatibility-v1',
 'ff7f08a4c78ee94fbfd020080ecbd27dfe0475c943e8623641c8dc52fbbcc7c1',
 'acf160ae-4efd-48d0-9d1b-7500f4cd0f41',
 '403b0f0648f1882047f10d179b122a3fb23c4f3cdbcb2c927b249a6f3d17b517',
 '60df64ac19d9919b53dfd71684e52572487c6f4dbfbf51412d150e2e89cfb041',
 '5407da48f92bde0ac391fa3f8be6d4ac8e6f9a4ff63bcfc4b78949ded04de32e',
 '5407da48f92bde0ac391fa3f8be6d4ac8e6f9a4ff63bcfc4b78949ded04de32e',
 0,0,0
);

DROP TABLE nexora_staging_email_unread_post_guard_v1;
DROP TABLE nexora_staging_email_unread_guard_v1;
