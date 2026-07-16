# F3 Logout Session Integrity & TTL Preservation — Repair Report

Mission: CLOUDMAIL LOGOUT SESSION INTEGRITY AND TTL PRESERVATION REPAIR
Date: 2026-07-16
Priority: P1
Authority baseline: commit `18f7f25…` / tag `v2026.07-baseline` / prod Worker `101308e4…`

## Outcome

Fixed, tested (10/10), committed, tagged, deployed to production, and health-verified.
No password/account/email/UCS code touched.

## Root defects (E1/E2)

Original `login-service.js:288-294`:
```js
async logout(c, userId) {
  const token =userContext.getToken(c);                                   // (a) not awaited
  const authInfo = await c.env.kv.get(KvConst.AUTH_INFO + userId, {type:'json'}); // (b) no null guard
  const index = authInfo.tokens.findIndex(item => item === token);
  authInfo.tokens.splice(index, 1);                                       // (c) index=-1 => removes LAST
  await c.env.kv.put(KvConst.AUTH_INFO + userId, JSON.stringify(authInfo)); // (d) no expirationTtl
}
```
- (a) `getToken` is `async`; the unawaited Promise never equals a token string, so
  `findIndex` **always** returned `-1` — compounding (c) so that *every* logout evicted
  the last active session, regardless of which device logged out.
- (b) `authInfo=null` → `authInfo.tokens` throws (500).
- (c) `splice(-1, 1)` removes the final array element — the wrong session.
- (d) `put` without `expirationTtl` stripped the 30-day TTL, making the record immortal.

## Fix

`login-service.js` — `logout` now awaits the token, delegates to a pure
`removeSessionToken(authInfo, token)` (null-safe; removes only the matched token;
never `splice(-1)`), skips the KV write when nothing changed, and writes with
`{ expirationTtl: constant.TOKEN_EXPIRE }` (30 days).

```js
const token = await userContext.getToken(c);
const authInfo = await c.env.kv.get(KvConst.AUTH_INFO + userId, { type: 'json' });
const { authInfo: next, removed } = removeSessionToken(authInfo, token);
if (!removed) return;
await c.env.kv.put(KvConst.AUTH_INFO + userId, JSON.stringify(next), { expirationTtl: constant.TOKEN_EXPIRE });
```

## Verification (V1–V6)

Test `scripts/reliability-tests/logout-session-integrity.test.mjs` — **10/10 pass**.

| ID | Scenario | Result |
|----|----------|--------|
| V1 | null / malformed authInfo | no throw, no write |
| V2 | missing token | removes nothing; last token NOT evicted |
| V3 | existing token | removes only the target (incl. first/last) |
| V4 | double logout (same token) | second is a no-op; other device survives |
| V5 | concurrent-representative sequence | only intended tokens removed |
| V6 | normal logout | KV write carries `expirationTtl=TOKEN_EXPIRE` (30d, =2592000) |

Regression: unit gate (`node --check` all `src`) green; `session-auth-transport` + F1 tests pass.

## Deployment evidence (E5)

| Field | Value |
|-------|-------|
| Fix commit | `e78ba127b2d0860ad5ec3398152444b744fc2b1e` |
| Release tag | `v2026.07-f3-logout` |
| Prior prod version (rollback ref) | `101308e4-0faf-4ecc-897d-6fd47753a012` (F1) |
| New prod version | `d05ffd3e-724f-4c43-ba7a-3229d6cda9f1` |
| Deploy time | 2026-07-16 13:42:22 UTC |
| Health (A10) | `GET /api/setting/websiteConfig` → HTTP 200, code=200; `/api/logout` route reachable (no 500); bindings + crons unchanged (UCS continuity preserved) |

## Audit answers

- **Missing token?** Nothing is removed; no KV write (TTL untouched).
- **Double logout safe?** Yes — second logout is a no-op; no other device evicted.
- **TTL consistent?** Yes — every mutating logout writes 30-day TTL; non-mutating logout leaves the existing TTL.
- **Fix commit?** `e78ba127…`. **Tag?** `v2026.07-f3-logout`. **Worker Version?** `d05ffd3e…`.

## Boundaries honored

Only `login-service.js` + its test changed. No password migration, no account/email
service, no UCS checkpoint/cursor/outbox/projection. No credentials entered.
