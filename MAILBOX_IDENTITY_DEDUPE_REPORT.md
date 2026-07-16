# Mailbox Identity Dedupe Report

## Result
PASS for dedupe foundation.

Worker OAuth upsert now matches active Gmail mailboxes by:
- requested account id
- normalized Gmail email
- Google OAuth subject id (`external_account_id`)

Duplicate active Gmail/Google Workspace rows for the same email or Google subject are archived after OAuth reconnect while preserving mailbox history.

## Evidence
- `archiveDuplicateGoogleMailboxes`
- `external_account_id` persisted on OAuth mailbox account.
- Reconnect mode returned as `reconnect_current_mailbox` when an account id is supplied.

