# ADR: Parameterized User Creation Security Repair (F1)

Status: Code fix Accepted & locally verified; deployment PENDING explicit authorization + UCS coordination
Date: 2026-07-16
Mission: CLOUDMAIL PARAMETERIZED USER CREATION SECURITY REPAIR AND PRODUCTION VERIFICATION
Related: `SECURITY_FINDINGS_TRIAGE_REPORT.md` (F1), `docs/ADR-SECURITY-FINDINGS-TRIAGE-2026-07-16.md`
Scope boundary: F1 only. F2/F3/F4/F5/F6 and all UCS state are OUT.

## 1. Risk source

`src/service/public-service.js` `addUser()` built two `INSERT` statements by
interpolating values directly into the SQL string via template literals, then
executed them through `c.env.db.prepare(...)` inside `c.env.db.batch(...)`.
It was the only template-literal `VALUES (...)` insert of request-controlled
data in the codebase.

## 2. Input flow analysis

- `email` — request body `list[].email` (`POST /public/addUser`, `public-api.js:15`).
- `type` — derived from request body `list[].roleName` via `roleService.roleSelectUse`.
- `os` / `browser` / `device` — `reqUtils.getUserAgent(c)` = `User-Agent` header (fully attacker-controlled).
- `active_ip` — `CF-Connecting-IP` header.
- `hash` / `salt` — server-computed (not attacker-controlled) but were also interpolated.

Reachability: `/public/*` is gated by the KV `public_key` header, minted only by
admin-authenticated `POST /public/genToken`. Privilege-gated, but every injected
value is arbitrary request input once the token is held. Admin-gating was NOT
accepted as a reason to leave the sink unparameterized.

## 3. SQL sink analysis (before)

```js
const userSql = `INSERT INTO user (email, password, salt, type, os, browser, active_ip, create_ip, device, active_time, create_time)
VALUES ('${email}', '${hash}', '${salt}', '${type}', '${os}', '${browser}', '${activeIp}', '${activeIp}', '${device}', '${activeTime}', '${activeTime}')`
const accountSql = `INSERT INTO account (email, name, user_id)
VALUES ('${email}', '${emailUtils.getName(email)}', 0);`;
userList.push(c.env.db.prepare(userSql));
userList.push(c.env.db.prepare(accountSql));
```

A single quote in `email`/`roleName`/`User-Agent` broke the statement or opened
an injection sink.

## 4. Fix / parameter-binding strategy (after)

`public-service.js:138-150` — both inserts now use D1 numbered parameters and
`.bind()`; no external value touches the SQL string. `?7` (active_ip) and `?9`
(active_time) are reused for their `create_ip` / `create_time` twins, preserving
the original column semantics exactly.

```js
const userStmt = c.env.db.prepare(
  `INSERT INTO user (email, password, salt, type, os, browser, active_ip, create_ip, device, active_time, create_time)
   VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7, ?8, ?9, ?9)`
).bind(email, hash, salt, type, os, browser, activeIp, device, activeTime);

const accountStmt = c.env.db.prepare(
  `INSERT INTO account (email, name, user_id) VALUES (?1, ?2, 0)`
).bind(email, emailUtils.getName(email));

userList.push(userStmt);
userList.push(accountStmt);
```

The subsequent `UPDATE account SET user_id = (SELECT ...) WHERE user_id = 0` is a
static string with no external input; it is unchanged. The batched multi-statement
shape and error handling (`SQLITE_CONSTRAINT` → `emailExistDatabase`) are unchanged.

## 5. Backward-compatibility analysis

- Column order, count, and duplicated `active_ip`/`active_time` values are identical.
- `type` was previously interpolated as a quoted string (`'${type}'`); it is now
  bound as its native value. SQLite column affinity stores it identically. No schema
  or read-path change.
- Account local-part still `emailUtils.getName(email)`; email stored verbatim (no
  new normalization). Behavior is equivalent for all valid inputs and now also
  correct for values containing quotes.

## 6. Rollback plan

- Source: the change is confined to `public-service.js:138-150`; revert that hunk
  to restore prior behavior (not recommended — reintroduces the sink).
- Deployment: production rollback uses `wrangler rollback` / redeploy of the prior
  version id (staging var notes rollback "requires separate approval"). No D1
  migration is involved, so rollback is code-only and data-safe.

## 7. Verification evidence (completed)

- Automated regression test: `scripts/reliability-tests/public-add-user-parameterization.test.mjs` — 4/4 pass under `@cloudflare/vitest-pool-workers`. Asserts: no `${`/quoted `VALUES` in any emitted SQL; `?1..?9` present; bound args carry raw values including a single-quote email (`o'brien@example.com`) unchanged; UA-derived `browser` (`Saf'ari`) bound; `roleName` resolves to a bound role id; static backfill UPDATE has no bound input.
- Static: `grep "VALUES ('"` no longer matches `public-service.js`; `grep "VALUES (" | grep '${'` returns zero SQL-string interpolation (the lone `nexora-v3` hit is `${}` inside a `.bind()` argument, not the SQL).
- Gates: `npm run test:unit` (send-contract-check + `node --check` over all `src`) passes.

## 8. Deployment interaction with UCS (why deploy is gated, not executed here)

Production binding = Worker `cloud-mail`, D1 `cloud-mail` (`4c05…`), `UCS_ACTIVATION_ENABLED=true`, per-minute Gmail crons — the exact Worker the active UCS V3 completion Mission monitors. Staging (`cloud-mail-staging`, D1 `acf160…`, no crons, classification off) is fully binding-isolated. Per the triage mandate, a production redeploy must be staging-verified and scheduled against UCS monitor state (prefer W2 paused/unowned) so it is not misread as a W2 recovery regression. This Mission therefore stops before production deploy pending explicit authorization; no UCS checkpoint/cursor/outbox/projection was touched and projection reads remain 0%.

## 9. Decision

Accept the parameterized implementation. Land production only under an explicit
deploy authorization with a UCS-coordinated window and a live post-deploy smoke.
