# P31 Generic Zero-Touch UI/API Contract Report

## Status

`ui_api_contract = READY`

## API

- `GET /api/v2/p31/cloudflare/zones`
- `POST /api/v2/p31/domains/select`
- `GET /api/v2/p31/domains/:domain/scan`
- `POST /api/v2/p31/domains/:domain/enable`
- `GET /api/v2/p31/ui-contract`

## UX States

- No Cloudflare connected
- Cloudflare connected but no domain selected
- Domain selected
- Scan running
- Needs configuration
- Configuring
- DNS pending
- Ready
- Partial with blocker
- Failed

## Boundary

No UI polish was required in P31. This task established the stable API contract.
