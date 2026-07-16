-- Provider freshness is a set of independent facts.  None of these columns is
-- derived from account metadata, UI activity, OAuth refresh, or worker heartbeats.
ALTER TABLE account ADD COLUMN last_sync_attempt_at TEXT;
ALTER TABLE account ADD COLUMN last_successful_sync_at TEXT;
ALTER TABLE account ADD COLUMN last_message_received_at TEXT;
ALTER TABLE account ADD COLUMN last_provider_checkpoint_at TEXT;
ALTER TABLE account ADD COLUMN last_sync_failure_at TEXT;
ALTER TABLE account ADD COLUMN sync_failure_reason TEXT;

CREATE INDEX IF NOT EXISTS account_provider_sync_freshness_idx
  ON account(user_id, provider, last_successful_sync_at);
