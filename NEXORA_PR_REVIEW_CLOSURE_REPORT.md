# NEXORA PR Review Closure Report

Assessment date: 2026-07-18

PR: https://github.com/billyadult002/cloud-mail/pull/1

Base: `main` at `a7b45d0242dad22c638564bed6589c547b19f807`

Initial reviewed head: `e995e4847832865846f37cbcf03cb21ac2b3cb0f`

Review branch: `codex/nexora-production-integration-5d7024d`

## PR Identity

- PR exists: `PASS`
- PR state: `OPEN`
- Draft state: `NON_DRAFT`
- Base branch: `main`
- Head branch: `codex/nexora-production-integration-5d7024d`
- Mergeability before successor fix: `MERGEABLE`
- Remote main unchanged during review: `a7b45d0242dad22c638564bed6589c547b19f807`
- Branch topology: `origin/main` is an ancestor of the PR branch

## GitHub Checks

- `gh pr checks 1`: `NOT_CONFIGURED`
- `gh run list --branch codex/nexora-production-integration-5d7024d`: `NOT_CONFIGURED`
- Repository workflow definitions: `.github/workflows/deploy-cloudflare.yml` exists, but it triggers on `push` to `main` and `workflow_dispatch`, not on PR.
- Branch Protection API: `BRANCH_PROTECTION_API_INACCESSIBLE_TOKEN_SCOPE`
- PR comment mutation: `INACCESSIBLE_TOKEN_SCOPE`
- Review decision before successor fix: no GitHub reviews returned by `gh pr view`.

No absent GitHub check is treated as a pass.

## Local Review Gates

- `npm test`: `PASS`
- `npm run test:rc`: `PASS`, 13 files / 144 tests after the P1 JWT verification fix
- `git diff --check`: `PASS`
- `npm audit --audit-level=moderate`: `PASS`, 0 vulnerabilities
- `npm ls --omit=dev --depth=0`: `PASS`
- Scoped secret scan over successor diff: `PASS`, retained matches are deterministic fixture token strings in tests only

## Findings

### P1 Resolved: Unverified OIDC `id_token` Claims Were Trusted Before Token Storage

Affected files:

- `mail-worker/src/service/nexora-onboarding-token-exchange-service.js`
- `mail-worker/src/service/nexora-onboarding-orchestrator-service.js`

Finding:

The reviewed head decoded `id_token` payload claims without cryptographically verifying the JWT signature, issuer, audience, expiry, or nonce before using `sub`, `email`, and Microsoft `tid` to authorize token storage and tenant/account binding. This was acceptable for the previous `LOGIC_COMPLETE_PARTIAL` checkpoint but not for production Provider onboarding.

Resolution:

Added RS256 JWKS verification for Google and Microsoft OIDC tokens. The callback path now fails closed with a precise `ID_TOKEN_*` blocker before token storage or sync dispatch when verification fails. Verification covers signature, `kid`, issuer, audience, expiry, optional `nbf`, and durable nonce hash where present.

Comail-first assessment:

Comail source `src-tauri/crates/comail-core/src/oauth/flow.rs` decodes the account email from `id_token` but does not provide JWKS verification. The NEXORA fix is classified as `COMAIL_GUIDED_IMPLEMENTATION_WITH_PRODUCTION_HARDENING`, not copied or translated code.

Verification:

- `nexora-onboarding-token-exchange.test.mjs` now covers successful signed JWT verification and audience mismatch rejection.
- `nexora-onboarding-orchestrator.test.mjs` now uses signed fixture JWTs/JWKS for the production callback chain and blocks unsigned `alg:none` tokens before storage.

### P1 Open: Real Callback Path Does Not Drive Exact-Once Verified Continuation Chain

Affected files:

- `mail-worker/src/service/nexora-onboarding-orchestrator-service.js`
- `mail-worker/src/service/durable-mission-runtime-service.js`
- `mail-worker/src/service/nexora-callback-continuation-service.js`

Finding:

The PR includes services and tests for `CALLBACK_OUTCOME_VERIFIED`, provider outcome results, provider-connection generation, token-connection binding, correlation consumption, Mission continuation, initial-sync intent, dispatch, and job identity. However, the real callback/orchestrator path stores tokens and dispatches initial sync directly after capability discovery. It does not create or invoke the full verified-result/finalization/correlation-consumption/Mission-continuation chain required by the production acceptance brief.

Impact:

Production acceptance cannot verify the required exact-once records from a real Google or Microsoft onboarding journey. This blocks merge, production migration, deployment, Provider onboarding, Desktop acceptance, physical-iPhone acceptance, rollback/restoration, and `PRODUCTION_AND_REAL_DEVICE_PASS`.

Classification:

`FIX_BEFORE_PRODUCTION`

Required resolution:

Wire the real callback path through NEXORA's verified callback finalization and continuation authorities, or record a reviewed repository policy that makes a different production driver canonical. The final implementation must produce observable records for Token Generation, Provider-Connection Generation, Canonical Callback Verified Result, `CALLBACK_OUTCOME_VERIFIED`, Correlation Consumption, Mission Continuation, Initial-Sync Intent, Initial-Sync Dispatch, and Initial-Sync Job during real Provider onboarding.

## Review Verdict

`PR_REVIEW_BLOCKED_P1_OPEN`

Do not merge, deploy, migrate production D1, bind production Provider Secrets, run real Provider onboarding, or perform Desktop/iPhone acceptance until the open P1 is resolved and the full verification gate is rerun.
