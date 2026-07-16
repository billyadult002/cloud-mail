DROP INDEX IF EXISTS idx_account_email;
DROP INDEX IF EXISTS idx_account_email_nocase;

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_native_email_nocase
ON account (email COLLATE NOCASE)
WHERE provider = 'cloudflare_native' AND is_del = 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_account_user_provider_email_nocase
ON account (user_id, provider, email COLLATE NOCASE)
WHERE is_del = 0;
