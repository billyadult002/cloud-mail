# ADR: CloudMail Security Findings Triage (2026-07-16)

Status: Accepted (triage only; no code or production change)
Context Mission: CLOUDMAIL SECURITY FINDINGS VERIFICATION AND AUTHORIZATION-BOUNDARY TRIAGE
Related: `SECURITY_FINDINGS_TRIAGE_REPORT.md` (full evidence)

## Finding source

External audit summary of six findings (F1–F6). Independently re-verified against the current authoritative working tree — external report conclusions were NOT adopted as-is.

## Verified source revision

- Workspace: `/Users/billtin/Documents/cloudmail`
- No Git repository (none in dir, parent, or nested). Revision anchor = working-tree state on 2026-07-16.
- Worker package: `platform/cloud-mail/mail-worker` (`cloud-mail`; staging `cloud-mail-staging`).
- iOS: `files/GlassMail-project`.

## Decisions

| ID | Finding | Verdict | Decision |
|----|---------|---------|----------|
| F1 | `public-service.addUser` template-literal SQL | CONFIRMED_REACHABLE (admin/public-token gated, request-controlled input) | Fix by parameterization in a dedicated next Mission. Admin-gating NOT accepted as dismissal. |
| F2 | `applyCanonicalStates` duplicate `rows` query | CONFIRMED_REACHABLE (hot path) | Delete the superseded `workspace_mailboxes` query (line 80). Second query on `workspace_account_bindings` is authoritative (matches `list()` folder subquery). Not fallback, not merge. |
| F3 | `logout` null/missing-token/TTL | CONFIRMED_REACHABLE | Guard null, splice only when `index>-1`, restore `expirationTtl`. Medium-severity session integrity. |
| F4 | Single-round SHA-256 password KDF | CONFIRMED weakness; REQUIRES_PRODUCT_DECISION | Standalone migration Mission: versioned hash + PBKDF2/scrypt + lazy re-hash on login. No in-place swap. |
| F5 | `accountService.delete` not-found deref + dead var | CONFIRMED_REACHABLE (reliability); `setAllReceive` deref sub-claim NOT_REPRODUCED (already guarded) | 404 on not-found before deref; remove dead `let a=null`. |
| F6 | iOS Keychain `AfterFirstUnlock` (not ThisDeviceOnly) | REQUIRES_PRODUCT_DECISION | Not iCloud-synced (synchronizable unset); real vector = encrypted-backup restore. Product decision + real-iPhone acceptance before change. |

## Production reachability

F1 privilege-gated behind admin/public-token but request-controlled; F2/F3/F5 authenticated-user reachable; F4 spans all auth paths; F6 real-device/backup-restore only.

## Authorization boundary

- `/public/*` gated by KV `public_key` header (minted by admin-only `genToken`).
- `/logout`, `/account/delete`, `/email/list` require a valid session JWT (`security.js` middleware).
- `assertGovernanceScope` / `requiredPermForRoute` unaffected by these findings.

## Fix alternatives / migration requirements

- F1: `.bind()` parameterization (low risk, mechanical).
- F3: guard + TTL restore (low risk).
- F4: versioned KDF with lazy re-hash — backward-compatible; requires schema discriminator (column or hash prefix) and a rollout window; do NOT combine with F2.
- F2/F5: mechanical low-risk reliability; may be bundled together.
- F6: attribute change rewrites Keychain items; needs on-device validation.

## Backward compatibility

F4 must read legacy SHA-256 hashes and transparently upgrade on next successful login. All other fixes are behavior-preserving except the intended correctness/integrity changes.

## Deployment interaction with UCS monitor

F1–F5 remediation requires a `cloud-mail` Worker redeploy — the same Worker the UCS V3 completion monitor observes. Mandate: land + verify on `cloud-mail-staging` first, then deploy in coordination with UCS monitor state (prefer W2 paused/unowned) so it is not misread as a W2 recovery regression. This triage made no such change.

## Accepted / rejected

- Accepted as real, actionable: F1, F2, F3, F5.
- Accepted as real but product-gated: F4 (migration), F6 (device acceptance).
- Rejected sub-claim: `setAllReceive` null-deref (already guarded → NOT_REPRODUCED).

## Required follow-up Missions (ordered by security impact × reachability)

1. CLOUDMAIL PARAMETERIZED USER CREATION SECURITY REPAIR AND PRODUCTION VERIFICATION (F1) — next.
2. CLOUDMAIL LOGOUT SESSION INTEGRITY AND TTL PRESERVATION REPAIR (F3).
3. CLOUDMAIL PASSWORD KDF MIGRATION (F4) — standalone, not combined.
4. CLOUDMAIL LOW-RISK RELIABILITY BUNDLE (F2 + F5).
5. CLOUDMAIL iOS KEYCHAIN HARDENING (F6) — product decision + real-iPhone acceptance.

## Constraints honored

No destructive production testing; no injection payloads; UCS checkpoint/cursor/outbox/projections unmodified; projection reads remain 0%; FULL_PRODUCTION_PASS not declared; no unverified external conclusion recorded as a confirmed vulnerability without independent evidence.
