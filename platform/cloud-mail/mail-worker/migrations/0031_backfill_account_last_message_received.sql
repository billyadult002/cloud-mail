-- This is ledger-only historical context, not proof of a provider sync.
-- Do not backfill last_successful_sync_at or last_provider_checkpoint_at.
UPDATE account
   SET last_message_received_at = (
     SELECT e.create_time
       FROM email e
      WHERE e.user_id = account.user_id
        AND e.account_id = account.account_id
        AND e.is_del = 0
      ORDER BY e.email_id DESC
      LIMIT 1
   )
 WHERE is_del = 0
   AND provider IN ('gmail', 'google_workspace')
   AND last_message_received_at IS NULL;
