# P32C Message Event Spine Report

## Status

`message_event_spine = READY`

## Events

- received
- parsed
- quarantined
- queued
- provider_accepted
- delivered_if_proven
- bounced
- failed
- retried
- cancelled
- read_if_observed
- secure_link_created
- secure_link_opened
- secure_link_revoked
- expired
- retained
- held
- soft_deleted
- purged

## Reuse Targets

- delivery troubleshooting
- audit log
- lifecycle engine
- compliance export
- All Mail / ledger

ProviderAccepted remains separate from Delivered. Delivered only exists with real evidence.
