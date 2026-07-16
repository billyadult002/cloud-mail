-- A Google OAuth reconnect is bound to one account generation.  A callback from
-- an older authorization window must never replace a newer credential.
ALTER TABLE account ADD COLUMN oauth_authorization_generation INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_account_google_reconnect_generation
  ON account(user_id, account_id, oauth_authorization_generation)
  WHERE is_del = 0 AND provider IN ('gmail', 'google_workspace');
