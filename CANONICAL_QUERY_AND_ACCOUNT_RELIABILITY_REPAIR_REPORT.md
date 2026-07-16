# F2 Canonical Query + F5 Account API Reliability Repair — Report

Mission: CLOUDMAIL F2 CANONICAL QUERY AND F5 ACCOUNT API RELIABILITY REPAIR WITH STAGING VERIFICATION
Date: 2026-07-16
Status: **CODE_FIXED_STAGING_VERIFIED** (staging only; production deployment held for a separate post-UCS-acceptance mission).

## Non-interference attestation (read-only production baseline)

Production Worker remains `525681a1` (F2/F5 not deployed to prod). `UCS_HWM_COMPLETION_ENABLED="true"`
unchanged. `projection_read_enabled=0` confirmed read-only (`rows_written=0`). No UCS
checkpoint/watermark/cursor/lease/outbox/projection/scheduler touched. **UCS evidence epoch files
(`task.md`, `implementation_plan.md`, UCS ADR/acceptance) were NOT written** by this mission.

## F2 — redundant canonical query removed

Path (E4): `GET /email/list` → `emailService.list()` → `applyCanonicalStates()`
(`src/service/email-service.js`).

**Before (E1/E2):** two consecutive queries assigned to the same `rows` variable inside one `try`:
```js
rows = (await ... JOIN workspace_mailboxes wm ...).all()).results || [];          // result discarded
rows = (await ... JOIN workspace_account_bindings wb ... 'READY' ...).all()).results || []; // overwrites
```
The first (`workspace_mailboxes`) result was **unconditionally overwritten** by the second before any
consumer read it — a superseded dead query, not a fallback/merge/dual-source (both tables exist, so it
was not a compatibility path). It only added a D1 round-trip and failure surface on the email-list hot path.

**After (V1/V2/V3/V4/A1/A2/A5):** the `workspace_mailboxes` query is deleted; `applyCanonicalStates`
issues exactly **one** canonical binding query on `workspace_account_bindings` (the canonical binding
authority, matching the same file's `list()` folder subquery). No fallback/merge added; canonical
output, error handling (`try/catch` compatibility path), and response contract are unchanged
(E7/A4). Each email-list load now does one fewer D1 query (A5).

## F5 — account.delete not-found contract + dead variable

Path (E9): `DELETE /account/delete` → `accountService.delete()` (`src/service/account-service.js`).

**Before (E8/E10, ADR-5):** `const accountRow = await this.selectById(...)` returns `undefined` for a
missing/foreign-invisible id, but `if (accountRow.email === user.email)` dereferenced it **before** any
existence check → `TypeError` → HTTP 500.

**After (E11/A7/A8, ADR-6):**
```js
const accountRow = await this.selectById(c, accountId);
if (!accountRow) { throw new BizError(t('noUserAccount'), 404); }   // not-found before any field access
if (accountRow.email === user.email) { ... }                        // delMyAccount (unchanged)
if (accountRow.userId !== user.userId) { ... }                      // foreign ownership denial (unchanged, E12)
// owned account -> original soft-delete + gmail-credential cleanup (unchanged, E13)
```
- missing account → stable **404** not-found (`BizError(..., 404)`; `BizError` default code is 501, so 404 is explicit) — V8/V9/A8.
- existing foreign account → ownership denial preserved — V10/A9/E12.
- owned account → original delete flow preserved — V11/A10/E13.

**setAllReceive:** already had a null guard (`if (!accountRow) return;`) so the deref subclaim is
**NOT_REPRODUCED** (ADR-7/A12/E14). Removed only the dead `let a = null` (no read, no behavior change) —
V14/A13/E15/ADR-8.

## Tests (E16 / A6 / A14)

`scripts/reliability-tests/f2-f5-reliability.test.mjs` — **7/7 pass** (pool-workers):
- F2: exactly one canonical prepare, on `workspace_account_bindings`, **zero** `workspace_mailboxes`
  (catches the old double-query, V6/V7); authoritative output mapping unchanged (V5/E7); empty list no-query.
- F5: missing→404 no-deletion (V8/V9), foreign→denied no-deletion (V10), owned→delete runs (V11),
  setAllReceive missing→no update (V13), setAllReceive existing→two updates (V15).

Gates (E17): `npm run test:unit` (send-contract + `node --check` all `src`) pass; related regression
(F1/F3/HWM + F2/F5) 33/33; `git diff --check` clean.

## Provenance (E18 / E19) — filled after staging deploy

- Implementation commit: see `git log` (this report + code + tests committed together).
- Annotated tag: `v2026.07-f2-f5-reliability`.
- Staging Worker Version / deploy time / health: see the staging section below (updated post-deploy).

## Audit answers

1. Deleted query: the `workspace_mailboxes`-joined canonical query in `applyCanonicalStates`.
2. Not a fallback: its result was overwritten unconditionally by the next line before use; both tables exist.
3. Canonical authority: `workspace_account_bindings` (with `lifecycle_state='READY'`).
4. D1 reduction: one fewer query per email-list load.
5. Canonical output changed? No — same mapping/fields; verified by test.
6. F2 tests: single-canonical-query + output-consistency + empty-list.
7. 500 cause: `accountRow.email` deref of `undefined` before existence check.
8. Guard location now: immediately after `selectById`, before any field access.
9. Missing returns: `BizError(t('noUserAccount'), 404)`.
10. Foreign protected? Yes — ownership check unchanged.
11. Owned unchanged? Yes — soft-delete + gmail cleanup.
12. setAllReceive subclaim NOT_REPRODUCED: it already returns on null before deref.
13. Dead var removed: `let a = null`.
14. F5 tests: missing/foreign/owned + setAllReceive missing/existing.
15/16/17. targeted 7/7, regression 33/33, unit+syntax+diff gates pass.
18/19/20/21. Commit/tag/staging-version/health — provenance section.
22–24. prod Worker `525681a1`, flag true, reads 0% — read-only confirmed, unchanged.
25. UCS evidence epoch written? No.
26. Production state modified? No.
27. Current state: **CODE_FIXED_STAGING_VERIFIED**.
28. Production hold: F2/F5 production deploy waits for UCS final acceptance, as a separate mission with
    its own Commit/Tag/Worker Version, not merged with F4 (ADR-9/ADR-10/A27).
