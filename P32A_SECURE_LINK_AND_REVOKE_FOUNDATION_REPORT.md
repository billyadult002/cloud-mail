# P32A Secure Link And Revoke Foundation Report

## Status

`secure_link_metadata_foundation = READY_AS_FOUNDATION_ONLY`

## Implemented Foundation

- Secure link metadata model.
- Secure link status model.
- Expiration timestamp field.
- Revoke status field.
- View limit field.
- Attachment download policy field.
- Audit hook model for open/download/revoke/expire.
- Future API contract:
  - `POST /api/v2/security/secure-links/dry-run`
  - `POST /api/v2/security/secure-links/:id/revoke/dry-run`
  - `GET /api/v2/security/secure-links/contract`

## Allowed States

- `DRAFT`
- `ACTIVE`
- `EXPIRED`
- `REVOKED`
- `LEGAL_HOLD_LOCKED`
- `DISABLED`

## Boundary

Full Proton-style secure-send usability is not claimed. No real secure-link mail was sent.
