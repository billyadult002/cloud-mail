# Lifecycle Promotion Report

Date: 2026-07-07

## State Rules
- Auth/403 class failure: `needs_reconnect`.
- Legacy Gmail IMAP credential: `legacy_imap_unsupported`.
- Non-auth import failure without evidence: `sync_required` or `first_import_failed`.
- Non-auth import failure with Gmail ledger evidence: `mailbox_ready`.

## Production Result
- Account 44: promoted to `mailbox_ready` after 201 imported rows existed.
- Account 45: promoted to `mailbox_ready` after scheduled sync success.
- Account 46: remained `mailbox_ready`.
- Account 47: remains reconnect-required because it has no OAuth reference.
