# Lifecycle Platform Report

## Status

`lifecycle_platform = READY`

## Allowed States

- Pending Approval
- OAuth Required
- OAuth Connected
- Importing
- Mailbox Ready
- Reconnect Required
- Blocked
- Archived

## Boundary

Mailbox Ready requires explicit evidence from capability, sync, receive, and freshness. Reconnect routes to existing mailbox recovery, not Add Mailbox.
