# P32C Message Lifecycle State Machine Report

## Status

`message_lifecycle_state_machine = READY`

## States

- `ACTIVE`
- `HELD`
- `RETAINED`
- `EXPIRED_PENDING`
- `SOFT_DELETED`
- `PURGE_ELIGIBLE`
- `PURGED`
- `REVOKED`
- `DISABLED`

## Required APIs / Requests

- `requestDelete()`
- `requestExpire()`
- `requestPurge()`
- `requestAdminDelete()`
- `requestAttachmentPrune()`
- `requestRevoke()`
- `requestLegalHoldApply()`
- `requestLegalHoldRelease()`

## Invariant

`Legal Hold > Retention Minimum > Expiration > User Delete`

All paths are dry-run foundation paths. No real mail deletion or attachment purge was executed.
