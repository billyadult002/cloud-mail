-- Staging-only secure bootstrap substrate.
-- This migration creates configuration schema and a one-shot operation ledger.
-- It deliberately creates no user, account, workspace, connection, or OAuth row.

ALTER TABLE user ADD COLUMN reg_key_id INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account ADD COLUMN all_receive INTEGER NOT NULL DEFAULT 0;
ALTER TABLE account ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS setting (
 register INTEGER NOT NULL DEFAULT 0,
 receive INTEGER NOT NULL DEFAULT 0,
 title TEXT NOT NULL DEFAULT '',
 many_email INTEGER NOT NULL DEFAULT 0,
 add_email INTEGER NOT NULL DEFAULT 0,
 auto_refresh INTEGER NOT NULL DEFAULT 0,
 add_email_verify INTEGER NOT NULL DEFAULT 1,
 register_verify INTEGER NOT NULL DEFAULT 1,
 reg_verify_count INTEGER NOT NULL DEFAULT 1,
 add_verify_count INTEGER NOT NULL DEFAULT 1,
 send INTEGER NOT NULL DEFAULT 1,
 r2_domain TEXT,
 secret_key TEXT,
 site_key TEXT,
 reg_key INTEGER NOT NULL DEFAULT 0,
 background TEXT,
 tg_bot_token TEXT NOT NULL DEFAULT '',
 tg_chat_id TEXT NOT NULL DEFAULT '',
 tg_bot_status INTEGER NOT NULL DEFAULT 1,
 forward_email TEXT NOT NULL DEFAULT '',
 forward_status INTEGER NOT NULL DEFAULT 1,
 rule_email TEXT NOT NULL DEFAULT '',
 rule_type INTEGER NOT NULL DEFAULT 0,
 login_opacity REAL DEFAULT 0.88,
 resend_tokens TEXT NOT NULL DEFAULT '{}',
 notice_title TEXT NOT NULL DEFAULT '',
 notice_content TEXT NOT NULL DEFAULT '',
 notice_type TEXT NOT NULL DEFAULT '',
 notice_duration INTEGER NOT NULL DEFAULT 0,
 notice_position TEXT NOT NULL DEFAULT '',
 notice_offset INTEGER NOT NULL DEFAULT 0,
 notice_width INTEGER NOT NULL DEFAULT 400,
 notice INTEGER NOT NULL DEFAULT 0,
 no_recipient INTEGER NOT NULL DEFAULT 1,
 login_domain INTEGER NOT NULL DEFAULT 0,
 bucket TEXT NOT NULL DEFAULT '',
 region TEXT NOT NULL DEFAULT '',
 endpoint TEXT NOT NULL DEFAULT '',
 s3_access_key TEXT NOT NULL DEFAULT '',
 s3_secret_key TEXT NOT NULL DEFAULT '',
 force_path_style INTEGER NOT NULL DEFAULT 1,
 custom_domain TEXT NOT NULL DEFAULT '',
 tg_msg_from TEXT NOT NULL DEFAULT 'only-name',
 tg_msg_to TEXT NOT NULL DEFAULT 'show',
 tg_msg_text TEXT NOT NULL DEFAULT 'hide',
 min_email_prefix INTEGER NOT NULL DEFAULT 0,
 email_prefix_filter TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS nexora_staging_bootstrap_operations (
 singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),
 operation_id TEXT NOT NULL UNIQUE,
 request_digest TEXT NOT NULL CHECK(length(request_digest)=64),
 state TEXT NOT NULL CHECK(state IN ('DB_COMMITTED','KV_REFRESHING','READY_FOR_FIRST_AUTHORITY','FIRST_USER_CREATED','COMPLETE')),
 worker_version TEXT NOT NULL DEFAULT '',
 refresh_owner TEXT,
 refresh_lease_expires_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 completed_at TEXT
);

CREATE TRIGGER IF NOT EXISTS trg_nexora_staging_bootstrap_zero_authority
BEFORE INSERT ON nexora_staging_bootstrap_operations
WHEN
 (SELECT COUNT(*) FROM setting)<>0
 OR (SELECT COUNT(*) FROM user)<>0
 OR (SELECT COUNT(*) FROM account)<>0
 OR (SELECT COUNT(*) FROM workspaces)<>0
 OR (SELECT COUNT(*) FROM workspace_members)<>0
 OR (SELECT COUNT(*) FROM workspace_domains)<>0
 OR (SELECT COUNT(*) FROM workspace_account_bindings)<>0
 OR (SELECT COUNT(*) FROM workspace_account_delegations)<>0
 OR (SELECT COUNT(*) FROM workspace_membership_authorities)<>0
 OR (SELECT COUNT(*) FROM nexora_onboarding_state)<>0
 OR (SELECT COUNT(*) FROM nexora_onboarding_authorization_sessions)<>0
 OR (SELECT COUNT(*) FROM nexora_onboarding_tokens)<>0
 OR (SELECT COUNT(*) FROM nexora_onboarding_provider_connections)<>0
 OR (SELECT COUNT(*) FROM nexora_connections)<>0
 OR (SELECT COUNT(*) FROM nexora_connection_operations)<>0
 OR (SELECT COUNT(*) FROM nexora_oauth_authorization_session_bindings)<>0
 OR (SELECT COUNT(*) FROM nexora_oauth_callback_intakes)<>0
 OR (SELECT COUNT(*) FROM nexora_oauth_exchange_attempts)<>0
 OR (SELECT COUNT(*) FROM nexora_onboarding_callback_correlations)<>0
 OR (SELECT COUNT(*) FROM nexora_onboarding_callback_claims)<>0
 OR (SELECT COUNT(*) FROM nexora_onboarding_callback_checkpoints)<>0
 OR (SELECT COUNT(*) FROM nexora_onboarding_refresh_work)<>0
 OR (SELECT COUNT(*) FROM nexora_onboarding_reauthorization_work)<>0
 OR (SELECT COUNT(*) FROM nexora_onboarding_reauthorization_commit_results)<>0
 OR (SELECT COUNT(*) FROM nexora_onboarding_token_connection_bindings)<>0
 OR (SELECT COUNT(*) FROM nexora_callback_verification_attempts)<>0
 OR (SELECT COUNT(*) FROM nexora_callback_verified_results)<>0
 OR (SELECT COUNT(*) FROM nexora_callback_verified_outcome_finalizations)<>0
 OR (SELECT COUNT(*) FROM nexora_callback_verifier_authorizations)<>0
 OR (SELECT COUNT(*) FROM nexora_callback_correlation_consumption_results)<>0
 OR (SELECT COUNT(*) FROM nexora_provider_outcome_results)<>0
BEGIN
 SELECT RAISE(ABORT,'secure_staging_bootstrap_precondition_failed');
END;

CREATE TRIGGER IF NOT EXISTS trg_nexora_staging_bootstrap_no_delete
BEFORE DELETE ON nexora_staging_bootstrap_operations
BEGIN
 SELECT RAISE(ABORT,'secure_staging_bootstrap_immutable');
END;

CREATE TRIGGER IF NOT EXISTS trg_nexora_staging_bootstrap_single_first_user
BEFORE INSERT ON user
WHEN EXISTS (
 SELECT 1 FROM nexora_staging_bootstrap_operations
 WHERE singleton_id=1 AND state IN ('READY_FOR_FIRST_AUTHORITY','FIRST_USER_CREATED')
)
AND (SELECT COUNT(*) FROM user)<>0
BEGIN
 SELECT RAISE(ABORT,'secure_staging_bootstrap_first_authority_already_claimed');
END;

CREATE TRIGGER IF NOT EXISTS trg_nexora_staging_bootstrap_first_account
AFTER INSERT ON user
WHEN EXISTS (
 SELECT 1 FROM nexora_staging_bootstrap_operations
 WHERE singleton_id=1 AND state='READY_FOR_FIRST_AUTHORITY'
)
BEGIN
 INSERT INTO account(email,name,user_id)
 VALUES(NEW.email,substr(NEW.email,1,instr(NEW.email,'@')-1),NEW.user_id);
 UPDATE nexora_staging_bootstrap_operations
 SET state='FIRST_USER_CREATED',updated_at=CURRENT_TIMESTAMP
 WHERE singleton_id=1 AND state='READY_FOR_FIRST_AUTHORITY';
END;

CREATE TRIGGER IF NOT EXISTS trg_nexora_staging_bootstrap_valid_update
BEFORE UPDATE ON nexora_staging_bootstrap_operations
WHEN
 OLD.singleton_id<>NEW.singleton_id
 OR OLD.operation_id<>NEW.operation_id
 OR OLD.request_digest<>NEW.request_digest
 OR OLD.worker_version<>NEW.worker_version
 OR OLD.created_at<>NEW.created_at
 OR OLD.state='COMPLETE'
 OR NOT (
  (OLD.state='DB_COMMITTED' AND NEW.state='KV_REFRESHING'
   AND NEW.refresh_owner IS NOT NULL AND NEW.refresh_lease_expires_at IS NOT NULL AND NEW.completed_at IS NULL)
  OR (OLD.state='KV_REFRESHING' AND NEW.state='KV_REFRESHING'
   AND OLD.refresh_lease_expires_at<=CURRENT_TIMESTAMP
   AND NEW.refresh_owner IS NOT NULL AND NEW.refresh_lease_expires_at IS NOT NULL AND NEW.completed_at IS NULL)
  OR (OLD.state='KV_REFRESHING' AND NEW.state='DB_COMMITTED'
   AND NEW.refresh_owner IS NULL AND NEW.refresh_lease_expires_at IS NULL AND NEW.completed_at IS NULL)
  OR (OLD.state='KV_REFRESHING' AND NEW.state='READY_FOR_FIRST_AUTHORITY'
   AND NEW.refresh_owner IS NULL AND NEW.refresh_lease_expires_at IS NULL AND NEW.completed_at IS NULL)
  OR (OLD.state='READY_FOR_FIRST_AUTHORITY' AND NEW.state='FIRST_USER_CREATED'
   AND (SELECT COUNT(*) FROM user)=1
   AND (SELECT COUNT(*) FROM account)>=1
   AND NEW.completed_at IS NULL)
  OR (OLD.state='FIRST_USER_CREATED' AND NEW.state='COMPLETE'
   AND (SELECT COUNT(*) FROM user)=1
   AND EXISTS(
    SELECT 1 FROM account a
    JOIN workspace_members wm ON wm.user_id=a.user_id
    JOIN workspaces w ON w.id=wm.workspace_id
    WHERE a.user_id=(SELECT user_id FROM user LIMIT 1)
      AND a.is_del=0 AND wm.role='OWNER'
   )
   AND (SELECT COUNT(*) FROM workspaces)>=1
   AND NEW.refresh_owner IS NULL AND NEW.refresh_lease_expires_at IS NULL AND NEW.completed_at IS NOT NULL)
 )
BEGIN
 SELECT RAISE(ABORT,'secure_staging_bootstrap_invalid_transition');
END;
