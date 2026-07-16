# Gmail Auto Approve Governance Model Report

Implemented explicit separation:

- CloudMail Governance: `auto_approved`
- Google OAuth State: `oauth_launch_ready`, `oauth_success`, `testing_restricted`, `verification_required`, `workspace_admin_blocked`, `scope_not_approved`, `user_cancelled`, `unknown_error`
- Mailbox State: `not_ready`, `importing`, `mailbox_ready`

Because production migration was forbidden, the existing `google_oauth_test_user_requests.status` CHECK constraint was respected. New truth is persisted compatibly in notes and returned through API fields:

- `cloudmailGovernance`
- `googleOAuthState`
- `mailboxState`

Google provider failure no longer reverts CloudMail auto approval to pending.
