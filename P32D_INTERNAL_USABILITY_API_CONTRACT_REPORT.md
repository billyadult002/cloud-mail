# P32D Internal Usability API Contract Report

## Status

`internal_api_contract = PASS`

## Validated Contracts

- Lifecycle dry-run validation.
- Audit hash-chain validation.
- Secure link status validation.
- Inbound security verdict validation.
- Domain drift validation.
- Org permission check validation.
- Event spine validation.
- Aggregate validation endpoint.

## Endpoints

- `POST /api/v2/p32d/runtime/lifecycle/validate`
- `POST /api/v2/p32d/runtime/audit/hash-chain/validate`
- `POST /api/v2/p32d/runtime/message-event-spine/validate`
- `POST /api/v2/p32d/runtime/secure-link/validate`
- `POST /api/v2/p32d/runtime/inbound-security/validate`
- `POST /api/v2/p32d/runtime/domain-reconciler/validate`
- `POST /api/v2/p32d/runtime/rbac/validate`
- `POST /api/v2/p32d/runtime/mail-provider/validate`
- `GET /api/v2/p32d/runtime/internal-usability/contract`
- `POST /api/v2/p32d/runtime/validate-all`
