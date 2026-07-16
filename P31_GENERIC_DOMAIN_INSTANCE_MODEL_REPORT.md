# P31 Generic Domain Instance Model Report

## Status

`domain_instance_model = READY`

## Implemented States

- `NO_DOMAIN_SELECTED`
- `DISCOVERED`
- `SCANNING`
- `NEEDS_CONFIGURATION`
- `CONFIGURING`
- `DNS_PENDING`
- `ROUTING_PENDING`
- `SENDING_PENDING`
- `MAILBOX_PENDING`
- `SECURITY_PENDING`
- `READY`
- `PARTIAL_WITH_REAL_BLOCKER`
- `FAILED`

## Implemented

- Added generic selected-domain instance model via `selectDomain`.
- Supports no selected domain, one selected domain, future multiple domains, re-scan, retry setup, partial, ready, and failed states.
- Migration source model was updated to include the complete state set. No production migration was run.

## API

- `POST /api/v2/p31/domains/select`
