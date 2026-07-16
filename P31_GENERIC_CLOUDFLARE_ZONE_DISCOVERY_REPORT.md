# P31 Generic Cloudflare Zone Discovery Report

## Status

`cloudflare_zone_discovery = READY`

## Implemented

- Added generic zone discovery through `discoverZones(c)`.
- Added `CloudflareDomainCandidate` output shape:
  - `domain_name`
  - `zone_id_ref`
  - `account_ref`
  - `zone_status`
  - `nameserver_status`
  - `eligible_for_cloudmail`
  - `current_email_state`
  - `risk_flags`
- Discovery returns safe metadata only and never returns tokens, cookies, or provider credentials.
- No domain name is hardcoded into discovery.

## API

- `GET /api/v2/p31/cloudflare/zones`

## Boundary

If no Cloudflare API token is configured, discovery returns a real blocker instead of fabricating connected state.
