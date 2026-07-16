# ADR: Logout Session Integrity & TTL Preservation Repair (F3)

Status: Accepted — deployed (prod Worker `d05ffd3e…`)
Date: 2026-07-16
Related: `LOGOUT_SESSION_INTEGRITY_REPAIR_REPORT.md`, `SECURITY_FINDINGS_TRIAGE_REPORT.md` (F3),
`docs/ADR-DEPLOYMENT-PROVENANCE-STANDARD.md`

## ADR-1 — Original defect: `splice(-1,1)` evicted other sessions

`logout` computed `index = tokens.findIndex(t === token)` and unconditionally called
`tokens.splice(index, 1)`. When the token was not in the list, `index = -1` and
`splice(-1, 1)` removes the **last** array element — a different, still-valid session.
This was reachable on any double/stale logout. It was additionally guaranteed by a
missing `await` on the async `getToken`: the unawaited Promise never matched, so
`findIndex` always returned `-1` and every logout silently evicted the last session.

**Decision:** token removal is delegated to a pure `removeSessionToken(authInfo, token)`
that removes only the matched index and never `splice(-1)`; `getToken` is awaited.

## ADR-2 — Root cause of TTL loss

`login` and the auth middleware write `AUTH_INFO` with `expirationTtl = TOKEN_EXPIRE`
(30 days). `logout` wrote the same key **without** `expirationTtl`. In Cloudflare KV,
a `put` with no `expirationTtl` clears any prior expiration, so a single logout made
the session record permanent until the next login/day-boundary refresh re-applied a TTL.

**Decision:** `logout` writes with `{ expirationTtl: constant.TOKEN_EXPIRE }`, and only
writes when a token was actually removed (a no-op logout leaves the existing TTL intact).

## ADR-3 — Future AUTH_INFO lifecycle requirements

- Every write to `KvConst.AUTH_INFO + userId` MUST set `expirationTtl = TOKEN_EXPIRE`.
  No un-TTL'd `put` to this key is permitted (login, refresh, logout all comply).
- Session-token mutations MUST go through a null-safe, index-checked routine; never
  `splice(index, ...)` without confirming `index >= 0`.
- Token-derived comparisons MUST await async resolution (`getToken`) before matching.
- Logout is idempotent: repeating it with the same token is a no-op and never affects
  another session.

## Consequences

Logout now preserves multi-device session integrity and the 30-day TTL contract, is
null-safe, and is idempotent under double/concurrent invocation. Provenance:
commit `e78ba127…`, tag `v2026.07-f3-logout`, prod Worker `d05ffd3e-724f-4c43-ba7a-3229d6cda9f1`.
