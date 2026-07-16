CREATE UNIQUE INDEX IF NOT EXISTS idx_account_gmail_email_nocase
ON account (email COLLATE NOCASE)
WHERE provider = 'gmail' AND is_del = 0;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mail_provider_credentials_gmail_email_nocase
ON mail_provider_credentials (provider, email COLLATE NOCASE)
WHERE provider = 'gmail';
