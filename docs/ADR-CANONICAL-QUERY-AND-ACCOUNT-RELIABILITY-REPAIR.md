# ADR: F2 Canonical Query + F5 Account Reliability Repair

Status: Accepted — code fixed, staging-verified. Production deploy held (post-UCS-acceptance).
Date: 2026-07-16
Related: `CANONICAL_QUERY_AND_ACCOUNT_RELIABILITY_REPAIR_REPORT.md`, `SECURITY_FINDINGS_TRIAGE_REPORT.md` (F2/F5).

## ADR-1 — Deleted query & location

`src/service/email-service.js`, `applyCanonicalStates()` (email-list hot path). The removed statement
was the `mail_canonical_state ⨝ workspace_mailboxes ⨝ workspace_members` query whose result was assigned
to `rows` and then immediately overwritten.

## ADR-2 — It was a superseded dead query, not fallback/merge/compat/dual-source

The very next line reassigned `rows` **unconditionally** (no conditional, no merge) from the
`workspace_account_bindings` query before any consumer read `rows`. Both `workspace_mailboxes` (0028)
and `workspace_account_bindings` (0044/0045) exist, so it was not a compatibility fallback. It could
never influence output — only cost a D1 round-trip and add a failure surface.

## ADR-3 — workspace_account_bindings is the canonical binding authority

The same service standardizes on `workspace_account_bindings` (`lifecycle_state='READY'`,
`subject_user_id=tenant_id`) for canonical binding — e.g. `list()`'s `workspaceBoundCanonicalFolder`
subquery uses it. The retained query is the authoritative one.

## ADR-4 — F2 behavioral constraints (met)

Exactly one fewer D1 query per call; canonical-state output unchanged; `try/catch` compatibility
structure unchanged; no fallback/merge/dual-source added; routing and response contract unchanged.

## ADR-5 — F5 original not-found defect

`accountService.delete`: `selectById` returns `undefined` for a missing id; `accountRow.email` was read
before any existence guard → `TypeError` → HTTP 500 (not a stable not-found contract).

## ADR-6 — F5 fixed contract

- missing account → `BizError(t('noUserAccount'), 404)` (guard before first field access).
- existing foreign account → ownership denial (`accountRow.userId !== user.userId`), unchanged.
- owned account → original soft-delete + gmail-credential cleanup, unchanged.

## ADR-7 — setAllReceive subclaim NOT_REPRODUCED

`setAllReceive` already returns on `!accountRow` before any deref, so the reported null-deref subclaim
does not reproduce. No guard was added.

## ADR-8 — Dead variable removal is behavior-neutral

`let a = null` in `setAllReceive` was never read or assigned again; removing it changes no runtime
semantics.

## ADR-9 — Staging-only for this mission

This mission deploys to `cloud-mail-staging` only. No production deploy, no production config/flag/D1
change.

## ADR-10 — F2/F5 production deployment constraints

Production deployment must (a) wait until UCS final acceptance (Parity PASS → cutover → target Build →
real-iPhone) is complete, (b) use its own Commit/Tag/Worker Version per the provenance standard, and
(c) not be merged with F4 Password KDF migration. It is a separate future mission.
