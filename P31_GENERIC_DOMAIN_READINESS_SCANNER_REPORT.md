# P31 Generic Domain Readiness Scanner Report

## Status

`domain_readiness_scanner = READY`

## Implemented

Generic scanner now checks:

- MX
- SPF
- DKIM
- DMARC
- Email Routing
- Catch-all
- Email Worker route
- Email Sending readiness
- outbound provider readiness
- mailbox readiness
- identity readiness
- security foundation readiness

## States

Scanner normalizes results to:

- `READY`
- `MISSING`
- `INVALID`
- `CONFLICTING`
- `PENDING_PROPAGATION`
- `UNAUTHORIZED`
- `NOT_SUPPORTED`
- `UNKNOWN`

## API

- `GET /api/v2/p31/domains/:domain/scan`

## Boundary

Missing does not mean failed. Missing, unknown, unauthorized, and conflicting states are preserved distinctly.
