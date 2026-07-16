# NEXORA V2.5 — Production Security Closure Report

Date: 2026-07-10  
Release candidate: `CloudMail-NEXORA-v2.5-owner-signed.ipa`

## Evidence-backed closure

| Gate | Status | Evidence |
|---|---|---|
| Activation token response leakage | PASS (code) | `platform/cloud-mail/mail-worker/src/service/cloudmail-v2-service.js`: token is omitted unless both explicit E2E flags are set. |
| Attachment authorization | PASS (code) | `/oss/*` is authenticated, Gmail attachment account ownership is checked, generic attachment keys are user-scoped, and `/attachments/*` is rewritten through the authenticated route. |
| Resend webhook forgery/replay | PASS (code) | Svix id/timestamp/signature verification and 7-day KV event dedupe in `resend-service.js`. |
| Governance route authentication | PASS (code) | P31/P32C/security lifecycle routes require an authenticated user and domain ownership/admin scope in `security.js`. |
| Provider accepted vs delivered | PASS (code) | External send rows remain SENT; only internal persistence is DELIVERED; provider webhook is authoritative for external delivery. |
| OAuth disconnect cleanup | PASS (code) | Disconnect deletes mailbox credentials and marks Google accounts `needs_reconnect`. |
| Cross-account startup cache | PASS (code) | Inbox cache is not restored until server identity validation completes in `AppState.swift`. |
| Dependency high-severity audit | PASS | `npm audit --omit=dev --audit-level=high`: 0 high, 0 critical, 0 total after dependency upgrade. |
| Automated worker reliability tests | PASS | 11 files / 99 tests; `npm run check` passes. |
| Production DNS/SPF/DKIM/DMARC | BLOCKED | Requires live Cloudflare/DNS evidence and migration deployment; local tests cannot prove production records. |
| Real iPhone master audit | BLOCKED | No authenticated Bill’s iPhone 17 execution evidence in this run. |

## Release decision

The signed 2.5 IPA is build-valid, but the GPT65_6 global PASS and V3 gate remain **BLOCKED** until live DNS, deployed migration/runtime evidence, and the required real-device audit are completed.
