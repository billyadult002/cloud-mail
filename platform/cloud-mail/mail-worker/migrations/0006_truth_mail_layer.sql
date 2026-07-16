ALTER TABLE account ADD COLUMN provider TEXT NOT NULL DEFAULT 'cloudflare_native';
ALTER TABLE account ADD COLUMN domain TEXT NOT NULL DEFAULT '';
ALTER TABLE account ADD COLUMN external_account_id TEXT;
ALTER TABLE account ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'connected';
ALTER TABLE account ADD COLUMN last_synced_at TEXT;
ALTER TABLE account ADD COLUMN sync_error TEXT;

UPDATE account
   SET provider = COALESCE(NULLIF(provider, ''), 'cloudflare_native'),
       domain = LOWER(SUBSTR(email, INSTR(email, '@') + 1)),
       sync_status = COALESCE(NULLIF(sync_status, ''), 'connected')
 WHERE is_del = 0;

ALTER TABLE email ADD COLUMN provider TEXT NOT NULL DEFAULT 'cloudflare_native';
ALTER TABLE email ADD COLUMN account_email TEXT NOT NULL DEFAULT '';
ALTER TABLE email ADD COLUMN account_domain TEXT NOT NULL DEFAULT '';
ALTER TABLE email ADD COLUMN thread_id TEXT NOT NULL DEFAULT '';
ALTER TABLE email ADD COLUMN external_message_id TEXT NOT NULL DEFAULT '';

UPDATE email
   SET provider = 'cloudflare_native',
       account_email = COALESCE(
         NULLIF(account_email, ''),
         (SELECT a.email FROM account a WHERE a.account_id = email.account_id),
         to_email,
         ''
       ),
       account_domain = LOWER(SUBSTR(COALESCE(
         NULLIF(account_email, ''),
         (SELECT a.email FROM account a WHERE a.account_id = email.account_id),
         to_email,
         ''
       ), INSTR(COALESCE(
         NULLIF(account_email, ''),
         (SELECT a.email FROM account a WHERE a.account_id = email.account_id),
         to_email,
         ''
       ), '@') + 1)),
       external_message_id = COALESCE(NULLIF(external_message_id, ''), message_id, ''),
       thread_id = COALESCE(NULLIF(thread_id, ''), in_reply_to, message_id, '')
 WHERE is_del = 0;

CREATE INDEX IF NOT EXISTS email_provider_idx ON email(user_id, provider, email_id);
CREATE INDEX IF NOT EXISTS email_account_source_idx ON email(user_id, account_email, email_id);
CREATE INDEX IF NOT EXISTS email_provider_external_idx ON email(user_id, provider, account_id, external_message_id);
CREATE INDEX IF NOT EXISTS account_provider_idx ON account(user_id, provider, is_del);

CREATE TABLE IF NOT EXISTS mail_provider_credentials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  account_id INTEGER NOT NULL,
  provider TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  credential_ciphertext TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(user_id, provider, email)
);
