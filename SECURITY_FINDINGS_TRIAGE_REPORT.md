# CloudMail Security Findings Verification & Authorization-Boundary Triage

Mission: CLOUDMAIL SECURITY FINDINGS VERIFICATION AND AUTHORIZATION-BOUNDARY TRIAGE
Date: 2026-07-16
Scope: read-only source verification. No production deploy, no injection payloads, no D1 writes.

## Non-interference attestation

- No destructive production security testing was performed.
- No injection payload was sent to any production endpoint.
- UCS checkpoint, cursor, outbox and projections were NOT modified.
- Projection reads remain at 0% (`projection_read_enabled=0`, rollout 0%, epoch 1).
- FULL_PRODUCTION_PASS was NOT declared.
- `task.md` and `implementation_plan.md` (UCS evidence files) were NOT edited; this triage lives in dedicated artifacts to avoid polluting the UCS evidence epoch.

## CP1 — Repository boundary

- Workspace root: `/Users/billtin/Documents/cloudmail`
- Git topology: **no Git repository** in this dir, no parent Git root, no nested `.git`. There is no revision control; the authoritative source is the current working tree.
- Current branch / HEAD / dirty state: **N/A (not a Git repo)**. Revision anchor = working-tree contents as read on 2026-07-16.
- Worker package root: `platform/cloud-mail/mail-worker` (`wrangler.toml` name=`cloud-mail`, main=`src/index.js`; staging env=`cloud-mail-staging`).
- iOS project root: `files/GlassMail-project` (`GlassMail.xcodeproj`, `GlassMail.xcworkspace`).
- Test surfaces: `platform/cloud-mail/mail-worker/scripts/reliability-tests/*.test.mjs` (vitest, `npm run test:rc`) and `scripts/send-contract-check.mjs` (`npm run test:unit`). No `*.test.js` inside `src`.

---

## Finding-by-finding verdict

Format: Finding → Source Evidence → Reachability → Reproduction → Severity → Recommended Action → Verdict

### F1 — SQL string-concatenation in `public-service.addUser`

- **Source evidence**: `src/service/public-service.js:97` `addUser(c, params)`. Lines 138–142 build `userSql`/`accountSql` with template-literal interpolation:
  `INSERT INTO user (...) VALUES ('${email}', '${hash}', '${salt}', '${type}', '${os}', '${browser}', '${activeIp}', '${activeIp}', '${device}', ...)` and `INSERT INTO account (...) VALUES ('${email}', '${emailUtils.getName(email)}', 0)`.
  These are the **only** template-literal `VALUES (...)` inserts in the codebase; every other write uses `.bind(?n)`.
- **Input origin**: `email`, `password`, `roleName` come from `c.req.json()` body (`public-api.js:15`). `os`/`browser`/`device` come from `reqUtils.getUserAgent(c)` = `User-Agent` header (`req-utils.js:9`), which is fully request-controlled. `activeIp` from `CF-Connecting-IP`.
- **Data sink**: `c.env.db.prepare(userSql)` / `.prepare(accountSql)` executed via `c.env.db.batch(...)` (lines 144–152). No parameter binding.
- **Reachability**: route `POST /public/addUser` is mounted (`webs.js:35` imports `public-api`). Auth gate (`security.js:190-198`): `/public/*` requires the `Authorization` header to equal KV `public_key`. That token is minted only by `POST /public/genToken`, which requires admin email+password (`public-service.verifyUser`, `public-service.js:180`). So the sink is **privilege-gated behind the admin/public-token**, but the injected values are arbitrary request input once the token is held. Per Mission rule, admin-gating is NOT accepted as a reason to dismiss.
- **Reproduction (non-destructive)**: static confirmation only — no payload sent. A legitimate admin submitting an email containing an apostrophe (e.g. `o'brien@domain`) breaks the batch (correctness/availability). A public-token holder controlling body `email`/`roleName` or the `User-Agent` header has an unparameterized injection sink. Existing tests: **none** cover `addUser`.
- **Severity**: High as a code defect (unbounded SQL injection sink + data-integrity break), mitigated in exposure by admin/public-token gating (not anonymous-reachable).
- **Recommended action**: convert both inserts to parameterized `.bind()` (matching the rest of the file); keep the batched multi-statement shape. Add a non-destructive regression test asserting bound parameters / rejecting quote-bearing input.
- **Verdict: CONFIRMED_REACHABLE** (privilege-gated, request-controlled input, active, unparameterized, untested).
- **Status update (2026-07-16):** FIXED_DEPLOYED — `public-service.js:138-150` uses D1 `.bind()` for all inputs; regression test `public-add-user-parameterization.test.mjs` 4/4; unit gate green. Deployed to production `cloud-mail` Version `101308e4-0faf-4ecc-897d-6fd47753a012` at 13:25:50 UTC (rollback ref `338018fc-…`); post-deploy health HTTP 200. Remaining to reach FIXED_VERIFIED: the operator's credentialed live create-user smoke with a single-quote address (admin token required; not run here). See `PARAMETERIZED_USER_CREATION_SECURITY_REPAIR_REPORT.md` and `docs/ADR-PARAMETERIZED-USER-CREATION-SECURITY-REPAIR.md`.

### F2 — `applyCanonicalStates` overwrites `rows` (duplicate query)

- **Source evidence**: `src/service/email-service.js:73` `applyCanonicalStates(c, list, userId)`. Line 80 assigns `rows` from a query joining `workspace_mailboxes wm` + `workspace_members m`; line 81 **unconditionally reassigns** `rows` from a query joining `workspace_account_bindings wb` (`lifecycle_state='READY'`, `subject_user_id=s.tenant_id`) + `workspace_members m`. The line-80 result is discarded.
- **Business semantics**: the authoritative binding source in this file is `workspace_account_bindings` — the same join used by `list()`'s `workspaceBoundCanonicalFolder` subquery (`email-service.js:157`). `workspace_mailboxes` (migration `0028`) predates `workspace_account_bindings` (migrations `0044`/`0045`, aligned with the UCS cutover `0047`). The line-80 query is a **superseded** source; line 81 is the intended one.
- **Table existence**: both `workspace_mailboxes` and `workspace_account_bindings` exist in migrations, so line 80 does **not** throw — it silently costs one extra D1 round-trip. Both queries sit inside one `try/catch` that falls back to `compatibility_unavailable` on any error, so the redundant query also adds failure surface to a hot path.
- **Reachability**: called from `list()` (`email-service.js:234`), i.e. every `GET /email/list` page load. Hot path.
- **Reproduction**: static confirmation; no test exists for `applyCanonicalStates`.
- **Severity**: Low (performance + reliability; no correctness or security impact — output is governed by the second query).
- **Recommended action**: **delete line 80** (remove the superseded `workspace_mailboxes` query). Not a fallback and not a merge — the second query is authoritative and the surrounding folder logic already standardizes on `workspace_account_bindings`.
- **Verdict: CONFIRMED_REACHABLE** (redundant dead query; intent = keep line 81).
- **Status update (2026-07-16): CODE_FIXED_STAGING_VERIFIED** — `workspace_mailboxes` query removed from `applyCanonicalStates`; single `workspace_account_bindings` canonical query remains; tests 7/7. Commit `2234b7bf`, tag `v2026.07-f2-f5-reliability`, staging Worker `d473b56f`. **Not production-deployed** (held for post-UCS-acceptance mission). See `CANONICAL_QUERY_AND_ACCOUNT_RELIABILITY_REPAIR_REPORT.md`.

### F3 — `login-service.logout` token integrity + TTL

- **Source evidence**: `src/service/login-service.js:288-294`.
  - `const authInfo = await c.env.kv.get(AUTH_INFO+userId, {type:'json'})` — no null guard; `authInfo.tokens.findIndex(...)` throws if null.
  - `const index = tokens.findIndex(t===token); tokens.splice(index, 1)` — when the token is absent, `index === -1` and `splice(-1, 1)` **removes the last token in the array**, i.e. a *different* active session.
  - `c.env.kv.put(AUTH_INFO+userId, JSON.stringify(authInfo))` — **no `expirationTtl`**, unlike login (`login-service.js:284`, TTL=`TOKEN_EXPIRE`=30d) and the middleware refresh (`security.js:241`, TTL=30d). Logout therefore strips the 30-day TTL, making the session record persist indefinitely until the next login/day-boundary refresh re-applies a TTL.
- **Reachability**: `DELETE /logout` (`login-api.js:35`), authenticated. `authInfo` was just loaded non-null by `security.js:211` on the same request, so the null-deref path is a **narrow race** (KV expiry/concurrent empty), lower likelihood. The missing-token path is reachable via **double logout / concurrent logout** and token rotation.
- **Reproduction (deterministic, local/unit-level)**: pure-function behavior can be proven with a mock KV covering: null authInfo → throws; empty tokens → `findIndex=-1`, `splice(-1,1)` no-op; missing token with N≥2 tokens → removes the last (wrong) token; first/middle/last token → only middle/last cases behave correctly; concurrent double-logout → second call evicts a surviving session; TTL → key loses expiration. **No such test exists** (`session-auth-transport.test.mjs` only covers `token-transport` read/cookie, not `logout`).
- **Severity**: Medium (session integrity: an unrelated device can be logged out; TTL contract regression; unhandled 500 on null).
- **Recommended action**: guard `if (!authInfo) return;`; only splice when `index > -1`; re-apply `{ expirationTtl: TOKEN_EXPIRE }` on the put. Add the multi-case unit test above.
- **Verdict: CONFIRMED_REACHABLE**.
- **Status update (2026-07-16):** FIXED_DEPLOYED — `login-service.logout` now awaits `getToken` (an unawaited async Promise had made `findIndex` always `-1`, so every logout evicted the last session), guards null authInfo, removes only the matched token via pure `removeSessionToken`, and writes with `expirationTtl=TOKEN_EXPIRE`. Test `logout-session-integrity.test.mjs` 10/10. Commit `e78ba127…`, tag `v2026.07-f3-logout`, prod Worker `d05ffd3e-724f-4c43-ba7a-3229d6cda9f1` (health OK). See `LOGOUT_SESSION_INTEGRITY_REPAIR_REPORT.md`.

### F4 — Password hashing: single-round SHA-256 + non-constant-time compare

- **Source evidence**: `src/utils/crypto-utils.js`. `genHashPassword` = `SHA-256(salt + password)` single round (lines 18–23); `generateSalt` = 16 random bytes base64 (lines 5–9); `verifyPassword` returns `hash === storedHash` (line 27, non-constant-time string compare).
- **Storage schema**: `src/entity/user.js:7-8` — `password: text`, `salt: text`. **No algorithm/version column** anywhere (grep for pbkdf2/bcrypt/scrypt/argon/hashVersion = none).
- **All read/write call sites**: hash-write — `login-service.js:131` (register), `public-service.js:111` (bulk addUser), `user-service.js:64/333` (reset/set), `cloudmail-v2-service.js:827` (provisioning). verify — `login-service.js:253` (login), `public-service.js:188` (admin verify), `mailbox-authorization-service.js:40` (delegated send). Reset entrypoints: `my-api.js:11` → `userService.resetPassword`, `password-reset-service.js:94`, `cloudmail-v2-service.js:841`.
- **Reachability**: every authentication path. Real-world exposure is offline-crack resistance of stored hashes if the DB leaks.
- **Reproduction**: static confirmation only. **No password value, hash, or salt was read or emitted** (per Mission constraint). No hashing test exists.
- **Severity**: Medium (weak KDF; single SHA-256 is cheap to brute-force; `===` is a minor timing side-channel).
- **Recommended action**: migrate to PBKDF2 (Workers `crypto.subtle.deriveBits`, ≥100k iters) or scrypt/argon2 via a versioned hash tag, with **lazy re-hash on successful login** and a version/algorithm discriminator column or hash prefix. This requires a dedicated migration design — **not** an in-place algorithm swap.
- **Verdict: CONFIRMED_REACHABLE** for the weakness; remediation is **REQUIRES_PRODUCT_DECISION** (separate migration Mission with backward compatibility).

### F5 — `accountService` not-found deref + dead variable

- **Source evidence**: `src/service/account-service.js`.
  - `delete(c, params, userId)` (line 171): `selectById` (global, un-scoped) at 176 returns `undefined` when not found; line 178 `if (accountRow.email === user.email)` dereferences before any existence/ownership check → TypeError → 500.
  - `setAllReceive` (line 322): **already guards** `if (!accountRow) return;` (line 326). Contains dead `let a = null` at line 323 (never used).
- **Ownership behavior**: `delete` does check `accountRow.userId !== user.userId` (line 182) — but only after the unguarded deref at 178, so a bad `accountId` 500s instead of returning 404/403.
- **Reachability**: `DELETE /account/delete` with a non-existent/foreign `accountId`.
- **Reproduction**: static; no test.
- **Severity**: Low (reliability/API-contract: 500 instead of 404; no data exposure — ownership is still enforced for existing rows).
- **Recommended action**: in `delete`, add `if (!accountRow) throw new BizError(t('noUserAccount'), 404);` before deref; remove dead `let a = null` in `setAllReceive`. Standardize not-found→404, foreign→403.
- **Verdict: CONFIRMED_REACHABLE** (reliability contract; `setAllReceive` deref sub-claim = NOT_REPRODUCED — already guarded).
- **Status update (2026-07-16): CODE_FIXED_STAGING_VERIFIED** — `account.delete` now guards not-found (`BizError(...,404)`) before any `accountRow` field access; foreign/owned behavior unchanged; dead `let a = null` removed from `setAllReceive` (deref sub-claim NOT_REPRODUCED). Tests 7/7. Commit `2234b7bf`, tag `v2026.07-f2-f5-reliability`, staging Worker `d473b56f`. **Not production-deployed** (held for post-UCS-acceptance mission).

### F6 — iOS Keychain accessibility class

- **Source evidence**: `files/GlassMail-project/GlassMail/Services/Keychain.swift:28` — every item stored with `kSecAttrAccessibleAfterFirstUnlock`. No `kSecAttrSynchronizable` set anywhere (grep = single hit, the accessible attr only), so items are **not** iCloud-Keychain synced (default false).
- **Secrets stored** (per `AppState.swift`): session auth token (`tokenKey`, `:284`), secure device reference (`:1462-1466`), owner-Mac broker pair ID + secret (`:3432-3433`). All use the same class.
- **Backup/migration behavior**: `AfterFirstUnlock` (without `ThisDeviceOnly`) → items are **included in encrypted device backups** and can be restored to a different device. `ThisDeviceOnly` would exclude them. iCloud-Keychain cross-device sync is **not** occurring (synchronizable unset), so the report's "migrates to other devices via iCloud" framing is only partially accurate — the real vector is encrypted-backup restore.
- **Reachability**: real device / backup-restore scenario only; not simulator-observable for the backup path.
- **Severity**: Low–Medium, threat-model dependent (session token + broker secret recoverable from an encrypted backup on a new device).
- **Recommended action**: product decision on `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly` (or `WhenUnlockedThisDeviceOnly` for the token), with a **real-iPhone acceptance pass** — changing accessibility rewrites items and must be validated on device, not simulator.
- **Verdict: REQUIRES_PRODUCT_DECISION** (confirmed attribute; hardening gated on product + real-device acceptance).
- **Status update (2026-07-16): F6_DESIGN_COMPLETE** — product decision made: S1 token & S2 device reference → `AfterFirstUnlockThisDeviceOnly`; S3 broker pair ID & S4 broker secret → `WhenUnlockedThisDeviceOnly` (all device-bound, excluded from backup restore). Atomic `SecItemUpdate` idempotent migration + versioned hook, fail-closed status handling, real-iPhone backup/restore acceptance. **Not implemented / not deployed.** See `IOS_KEYCHAIN_HARDENING_DESIGN_REPORT.md` and `docs/ADR-IOS-KEYCHAIN-DEVICE-BOUND-HARDENING.md`.

---

## CP8 — Risk & deployment triage (priority by security impact × reachability, not diff size)

| Pri | Finding | Verdict | Severity | Deploy surface |
|-----|---------|---------|----------|----------------|
| P1 | F1 SQL addUser | CONFIRMED_REACHABLE | High (gated) | Worker redeploy |
| P2 | F3 logout integrity + TTL | CONFIRMED_REACHABLE | Medium | Worker redeploy |
| P3 | F4 password KDF | CONFIRMED / REQUIRES_PRODUCT_DECISION | Medium | Worker redeploy + migration |
| P4 | F2 duplicate canonical query | CONFIRMED_REACHABLE | Low (perf) | Worker redeploy |
| P4 | F5 account not-found contract | CONFIRMED_REACHABLE | Low | Worker redeploy |
| P5 | F6 iOS Keychain | REQUIRES_PRODUCT_DECISION | Low–Med | iOS build + real-device acceptance |

Combination rules (from acceptance): F2 + F5 (low-risk reliability) may be bundled; **F4 password migration must NOT be combined** with the duplicate-query optimization or any other change.

## CP-UCS — Impact on active UCS V3 completion Mission

- All findings live in auth / account / email-list / crypto / iOS code — **disjoint** from the UCS projection pipeline (checkpoint, cursor, outbox, projections, parity). No recommended fix reads or writes UCS state.
- **However**, F1–F5 remediation requires a **production Worker redeploy** of `cloud-mail`, which is the same Worker the UCS monitor observes. A redeploy can perturb in-flight W2 lease timing / runtime telemetry cadence. Therefore any emergency fix Mission must: (a) land + verify on `cloud-mail-staging` first, and (b) schedule the production deploy in coordination with the UCS monitor (ideally while W2 is paused/unowned) so it is not misread as a W2 recovery regression.
- This triage Mission itself made no code or production change.

## CP10 — Next single implementation Mission

Because F1 (SQL injection) is **CONFIRMED_REACHABLE**, per acceptance criteria the next Mission is:

**CLOUDMAIL PARAMETERIZED USER CREATION SECURITY REPAIR AND PRODUCTION VERIFICATION**
— parameterize `public-service.addUser` (both inserts) with `.bind()`, add a non-destructive regression test, verify on staging, then a UCS-coordinated production deploy. Duplicate-query optimization (F2) must NOT be done first.

Subsequent Missions, in order: F3 logout integrity + TTL → F4 password migration (standalone, versioned, lazy re-hash) → F2+F5 bundled reliability → F6 iOS Keychain (product decision + real-iPhone acceptance).

## Remaining uncertainty

- No Git history exists, so "which revision is in production" cannot be proven from the tree; production revision mapping is unavailable and must be confirmed at deploy time against the running `cloud-mail` Worker.
- F1 exposure depends on how tightly the admin/public-token is held operationally (not determinable from source).
