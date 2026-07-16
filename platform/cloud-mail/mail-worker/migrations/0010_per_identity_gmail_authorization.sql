-- P0J: Gmail authorization is scoped to a CloudMail identity, not globally owned.
-- The base tables already keep per-user uniqueness through:
--   account lookup by user_id/provider/email
--   mail_provider_credentials UNIQUE(user_id, provider, email)
-- Drop the P0G-era global uniqueness indexes so multiple CloudMail identities can
-- explicitly authorize the same Gmail mailbox without deleting or transferring
-- another identity's authorization.
DROP INDEX IF EXISTS idx_account_gmail_email_nocase;
DROP INDEX IF EXISTS idx_mail_provider_credentials_gmail_email_nocase;
