# NEXORA Evidence-First Hybrid Classification Implementation Report

Date: 2026-07-19

Branch: `codex/nexora-evidence-first-classification`

Base commit: `755a9cd4224e1f9cebabf430b833e1485e25fb0c`

## Scope

This successor branch implements the first server-authoritative slice of Option 5. It does not modify the pinned `main` or `codex/nexora-production-integration-5d7024d` branches, does not deploy, does not apply remote migrations, and does not alter Provider registration or Secrets.

## Current Defect Boundary

The canonical Worker did not contain durable mail semantic classification or VIP evidence records. Build 358 viewport evidence showed apparent retail promotions while a VIP surface was active, but the Apple source tree is not present in this pinned implementation branch. This branch therefore closes the Worker authority gap and leaves Desktop/iPhone projection acceptance blocked until the Apple source is included in a reviewed successor scope.

## Implemented

- D1 migration `0077_nexora_evidence_first_hybrid_classification.sql`
- Durable tables for:
  - verified Domain authority
  - message classification state
  - user/admin correction records
  - redacted classification evidence
- Worker service `nexora-email-classification-service.mjs`
- Protected Worker API:
  - `POST /v3/classification/evaluate`
  - `POST /v3/classification/persist`
  - `POST /v3/classification/correction`
- Contract check proving promotional/bulk/list traffic cannot auto-enter VIP.
- ADR for semantic category versus independent attribute separation and Comail provenance.

## Authority Boundary

- VIP is independent from semantic category.
- Priority is independent from semantic category.
- Action is independent from semantic category.
- Unread, starred, and attachment state are independent attributes.
- Automatic VIP is disqualified by strong promotional or bulk signals unless explicit user/admin authority exists.
- User corrections bind authority to the authenticated user context.
- Server classification persistence and admin corrections require configured admin authority.
- AI is not implemented in this slice and cannot establish authoritative VIP.

## Comail Provenance

- Repository: `https://github.com/NextOSP/comail`
- Branch: `master`
- Commit inspected: `38960219de19812bcb8dbd562ee91974e0787737`
- Release tag inspected: `v0.2.22` at `deba788b6386f2f2fc78aa7b6e0dc3a0a961be66`
- Source paths inspected: `LICENSE`, `src-tauri/crates/comail-core/src/models.rs`
- License observed: AGPL-3.0
- Reuse classification: `COMAIL_GUIDED_IMPLEMENTATION`
- Code copied, translated, or adapted: none
- Dependencies introduced: none

## Verification

- `npm ci`: passed, `0 vulnerabilities`
- `npm test`: passed
- `node scripts/classification-contract-check.mjs`: passed
- `npm run test:rc`: 13 files / 148 tests passed
- `npm audit --audit-level=moderate`: `0 vulnerabilities`
- `git diff --check`: passed
- Read-only remote migration list: only successor migration `0077_nexora_evidence_first_hybrid_classification.sql` is pending

## Open Gates

- Remote migration `0077` was not applied.
- Worker was not deployed.
- The visible data-format warning remains open and was not suppressed.
- Desktop and physical-iPhone classification acceptance were not performed because the Apple source tree is outside the pinned implementation branch.
- Real Provider onboarding and production acceptance remain blocked until Provider/admin authority is available and this successor branch receives review.

## Verdict

`SERVER_CLASSIFICATION_AUTHORITY_IMPLEMENTED_REVIEW_REQUIRED`
