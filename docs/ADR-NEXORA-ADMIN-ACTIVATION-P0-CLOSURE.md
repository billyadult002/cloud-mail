# ADR: NEXORA Admin Activation P0 Closure

Status: Accepted for merge candidate

## Decision

Domain Authority bootstrap is an exactly-once semantic operation scoped by the authenticated actor-derived tenant, selected Workspace, normalized domain, verified ownership lifecycle, and idempotency key. Migration 0080 adds durable operation receipts and operation-linked unique audit records. Authority generation changes only when the verified ownership proof changes; transport replay returns the canonical result.

Workspace selection is a verified-action boundary. The server issues a five-minute HMAC credential only from the explicit selector validation endpoint. It binds the server actor reference, authentication-session reference, Workspace, `domain:write`, Worker deployment, HMAC key version, and time bounds. DNS challenge creation, DNS verification, and Authority bootstrap require the credential and independently revalidate live membership and capability.

The Web application reuses the existing axios bearer-authentication chain. It never reads or renders authentication material. It compares `/my` identity with selector and validation actor identities, requires the exact `Workspace 1 — NEXORA Runtime Validation` server identity, and keeps the selection credential only in ephemeral memory. Every production mutation stage requires a separate explicit confirmation and never auto-chains.

## Bootstrap operation rules

- Same scoped key and request digest: return the existing receipt; no generation or audit change.
- Same scoped key with a different digest: fail closed.
- Concurrent keys for the same ownership event: converge through the ownership-event uniqueness boundary.
- New verified ownership event: one `REFRESHED` operation and one generation transition.
- Existing legacy authority with the same proof: `LEGACY_ADOPTED`; no fabricated historical audit.
- Revoked authority: never revived by bootstrap.
- Operation receipt, Authority transition, and both audit records commit in one D1 batch.

## Selection credential rules

- Integrity: HMAC-SHA-256 using the dedicated correlation secret.
- Maximum lifetime: five minutes.
- Bound fields: actor ID/reference, auth-session reference, Workspace, capability, deployment, HMAC key version, issued/expiry time.
- Failure codes: 401 for missing authentication context; 403 for authority/integrity/substitution denial; 409 for expiry or deployment/key continuity failure.
- Pending DNS challenge state is non-secret and may survive credential expiry. The operator must explicitly revalidate Workspace authority before continuing the same challenge.

## Authentication boundary

Cloud Mail primary authentication uses the `Authorization` header in both the Web axios interceptor and Worker security middleware. No primary Cookie session is issued or accepted. Logout revokes only the exact JWT session token from KV and clears cached Web actor state after success.

## Migration and deployment

- 0080 is schema-only and forward-compatible with the currently deployed Worker.
- It must be applied exactly once by the Wrangler tracked migration runner; manual statement execution is prohibited.
- Production deployment must be built from the verified merge SHA in a new clean worktree.
- This mission performs only post-deployment actor/workspace/capability reads. DNS, ownership, Authority, Classification, and Evidence writes remain prohibited.

## Residual hardening

The pre-existing global wildcard CORS policy remains a non-blocking P2. Bearer authentication is not ambient, so it does not create a current CSRF path; a future platform-wide ADR should restrict production origins, methods, and headers without breaking existing clients.
