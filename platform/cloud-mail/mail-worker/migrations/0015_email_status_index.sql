-- WF-9 / WP-E: index email.status so the daily completeReceiveAll sweep
-- (UPDATE ... WHERE status = SAVING ...) seeks instead of full-scanning the
-- whole email table. Composite with account_id also helps the EXISTS(account)
-- correlated check. Idempotent; no rename/drop.
CREATE INDEX IF NOT EXISTS email_status_idx ON email(status, account_id);
