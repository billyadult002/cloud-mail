# Gmail Approval DB Legacy Cleanup Plan

No destructive cleanup was run.

Safe plan:

- Classify `pending_google_test_user` rows without `enterprise_policy_requires_approval=true` as legacy pending.
- Classify `oauth_failed` rows as Google OAuth Blocked.
- Classify `oauth_success` rows as OAuth Success.
- Classify `approved_waiting_google_sync` rows with `cloudmail_governance=auto_approved` as Auto Approved Gmail.
- Do not delete rows without explicit authorization.
- Future additive migration can add separate governance/oauth/mailbox columns, then archive legacy rows.
