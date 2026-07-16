-- Gmail API 404 after a successful OAuth callback is not evidence that the
-- authorization should be repeated. Preserve the authorization and surface the
-- provider mailbox/service blocker instead of a false reconnect loop.
UPDATE account
   SET sync_status = 'provider_mailbox_unavailable',
       sync_error_class = 'provider_mailbox_unavailable',
       sync_error = 'Gmail API could not find an available mailbox for this authorized Google identity. Check Gmail service availability or Workspace licensing, then retry the provider check.',
       sync_failure_reason = 'Gmail API mailbox unavailable after verified OAuth authorization.',
       next_attempt_at = NULL
 WHERE is_del = 0
   AND provider IN ('gmail', 'google_workspace')
   AND sync_error_class = 'client'
   AND sync_error LIKE 'Gmail API 404:%';
