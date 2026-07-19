# NEXORA Test Inventory Reconciliation Report

Assessment date: 2026-07-18

PR: https://github.com/billyadult002/cloud-mail/pull/1

Reviewed branch: `codex/nexora-production-integration-5d7024d`

Reviewed head before successor route fix: `0681b4327c2c3b1012ed5dbd9ca17ee64b75e38e`

Historical checkpoint: `5d7024d1cea12b6425727fdeb28885cfb83cdf7b`

## Verdict

`INVENTORY_RECONCILED_WITH_RELOCATED_INTEGRATION_SUBSET`

The historical checkpoint contains 53 reliability files under `platform/cloud-mail/mail-worker/scripts/reliability-tests`. The PR integration branch is intentionally rebased onto the remote-main `mail-worker` layout and contains 13 reliability files before this report, now 13 files / 145 tests after adding real provider GET callback route coverage to `nexora-onboarding-orchestrator.test.mjs`.

The two inventories are not identical and must not be described as equivalent. The integration branch preserves and executes the outcome-critical callback, OIDC, recovery, rollback, continuation, Evidence, refresh, sync, and scorecard suites required for this PR. Broader historical application, UCS, classification, telemetry, and domain-governance suites are outside the reviewed NEXORA callback-production scope and are not present in the remote-main integration layout.

## Execution Commands

- Current integration suite: `cd mail-worker && npm run test:rc`
- Unit/syntax gate: `cd mail-worker && npm test`
- Historical inventory source: `git ls-tree -r --name-only 5d7024d1cea12b6425727fdeb28885cfb83cdf7b`

## Summary

| Inventory | Files | Tests | Result |
| --- | ---: | ---: | --- |
| Historical complete Worker checkpoint | 53 | 512 | External immutable evidence only |
| Integration branch before route fix | 13 | 144 | Passed |
| Integration branch after route fix | 13 | 145 | Passed |

## Explicit Comparison

| Historical test path | Integration path or mapping | Status | Outcome-critical classification | Reason / disposition |
| --- | --- | --- | --- | --- |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/atomic-classification-d1.test.mjs` | `-` | Missing | Out of scope | Classification D1 behavior is not modified by PR #1 callback continuation. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/classification-evaluation-v2.test.mjs` | `-` | Missing | Out of scope | Classification evaluation is outside Provider callback acceptance. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/classification-intelligence.test.mjs` | `-` | Missing | Out of scope | AI/classification intelligence is not modified. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/classification-p0-release-checker.test.mjs` | `-` | Missing | Out of scope | Historical release checker is not part of remote-main integration layout. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/commitment-lifecycle.test.mjs` | `-` | Missing | Out of scope | Commitment lifecycle is not touched by callback PR. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/delivery-ledger.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-evidence-outbox.test.mjs` | Mapped | Covered | Current Evidence outbox and delivered canonical evidence are tested in the integration branch. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/delivery-observability-query.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-callback-finalization-atomic.test.mjs` | Mapped | Covered | Redacted callback operational visibility is covered by current finalization tests. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/durable-mission-runtime.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-callback-finalization-atomic.test.mjs` | Mapped | Covered | Callback verifier/finalization uses `durable-mission-runtime-service.js` and exercises verifier authorization and canonical verified result authority. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/enterprise-authority-control-plane.test.mjs` | `-` | Missing | Out of scope | Enterprise control-plane behavior is not changed. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/f2-f5-reliability.test.mjs` | `-` | Missing | Out of scope | Historical feature reliability is outside PR #1 callback closure. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/final-hardening.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-atomic-rollback.test.mjs` | Mapped | Covered | Callback rollback and failure hardening are covered by current atomic rollback/finalization suites. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/gmail-platform-v2.test.mjs` | `-` | Missing | Out of scope | Gmail platform behavior is not directly changed by the callback continuation wiring. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/hybrid-mail-intelligence.test.mjs` | `-` | Missing | Out of scope | Hybrid mail intelligence is not modified. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/jwt-verify-missing-token.test.mjs` | `mail-worker/scripts/reliability-tests/jwt-verify-missing-token.test.mjs` | Present relocated | Covered | Executed by `npm run test:rc`. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/logout-session-integrity.test.mjs` | `-` | Missing | Out of scope | Login/logout session behavior is not modified. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/mail-action-integrity.test.mjs` | `mail-worker/scripts/send-contract-check.mjs` | Mapped | Covered for touched surface | Send contract is covered by `npm test`; broader mail actions are not touched. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-callback-continuation-exact-once.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-callback-continuation-exact-once.test.mjs` | Present relocated | Covered | Executed by `npm run test:rc`. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-callback-finalization-atomic.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-callback-finalization-atomic.test.mjs` | Present relocated | Covered | Executed by `npm run test:rc`. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-cloudflare-provider-foundation.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-oauth.test.mjs`; `nexora-onboarding-token-exchange.test.mjs` | Mapped | Covered | Provider endpoint/configuration behavior is covered by current OAuth/token exchange tests. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-mission-runtime-pool-workers.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-callback-finalization-atomic.test.mjs`; `nexora-callback-continuation-exact-once.test.mjs` | Mapped | Covered | Mission Runtime callback verifier and continuation authority are covered by current D1 tests. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-onboarding-atomic-rollback.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-atomic-rollback.test.mjs` | Present relocated | Covered | Executed by `npm run test:rc`. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-onboarding-evidence-outbox.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-evidence-outbox.test.mjs` | Present relocated | Covered | Executed by `npm run test:rc`. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-onboarding-failure-revocation-race-matrix.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-failure-revocation-race-matrix.test.mjs` | Present relocated | Covered | Executed by `npm run test:rc`. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-onboarding-http-routes.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-orchestrator.test.mjs` | Mapped and strengthened | Covered | Real provider GET callback route is now exercised through the Hono app with state+PKCE+D1 authority and signed OIDC fixture. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-onboarding-oauth.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-oauth.test.mjs` | Present relocated | Covered | Executed by `npm run test:rc`. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-onboarding-orchestrator.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-orchestrator.test.mjs` | Present relocated | Covered | Executed by `npm run test:rc`; now includes route-level provider callback test. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-onboarding-provider-discovery.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-orchestrator.test.mjs`; `nexora-onboarding-oauth.test.mjs` | Mapped | Covered for callback acceptance | Provider discovery decisions used by callback onboarding are covered through orchestrator/OAuth paths. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-onboarding-refresh-scheduler.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-refresh-scheduler.test.mjs` | Present relocated | Covered | Executed by `npm run test:rc`. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-onboarding-scorecard.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-scorecard.test.mjs` | Present relocated | Covered | Executed by `npm run test:rc`. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-onboarding-state-fingerprint.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-state-fingerprint.test.mjs` | Present relocated | Covered | Executed by `npm run test:rc`. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-onboarding-state-machine.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-orchestrator.test.mjs`; `nexora-onboarding-sync.test.mjs` | Mapped | Covered | Legal phase transitions are exercised through callback, cancellation, repair, and sync tests. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-onboarding-sync.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-sync.test.mjs` | Present relocated | Covered | Executed by `npm run test:rc`. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-onboarding-token-exchange.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-token-exchange.test.mjs` | Present relocated | Covered | Executed by `npm run test:rc`. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-onboarding-token-lifecycle.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-refresh-scheduler.test.mjs`; `nexora-onboarding-failure-revocation-race-matrix.test.mjs` | Mapped | Covered | Token lifecycle outcomes relevant to callback production are covered by refresh and race/failure suites. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-onboarding-token-storage.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-orchestrator.test.mjs`; `nexora-onboarding-atomic-rollback.test.mjs` | Mapped | Covered | Encrypted token storage, generation, and rollback are covered by current callback and rollback tests. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/nexora-v3.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-orchestrator.test.mjs` | Mapped | Covered for callback acceptance | V3 onboarding callback behavior is covered by current route/orchestrator test. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/outbound_state.test.mjs` | `-` | Missing | Out of scope | Outbound state is not touched. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/p31-domain-foundation.test.mjs` | `-` | Missing | Out of scope | Domain foundation is not touched. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/p32c-enterprise-governance.test.mjs` | `-` | Missing | Out of scope | Enterprise governance is not touched. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/p32d-runtime-validation.test.mjs` | `-` | Missing | Out of scope | Runtime validation outside callback path is not touched. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/provider-capability-contract.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-orchestrator.test.mjs` | Mapped | Covered | Provider capability decision contract is exercised through `discoverCapability()` in the real callback chain. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/public-add-user-parameterization.test.mjs` | `-` | Missing | Out of scope | Public add-user behavior is not modified. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/rc-state-machine.test.mjs` | `-` | Missing | Out of scope | RC state machine is not modified. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/runtime-telemetry.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-callback-finalization-atomic.test.mjs` | Mapped | Covered for callback visibility | Callback operational visibility redaction is covered. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/secure-auth-handoff.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-oauth.test.mjs` | Mapped | Covered for callback acceptance | PKCE verifier/callback handoff authority is covered by OAuth and route tests. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/sender-bulk-classification.test.mjs` | `-` | Missing | Out of scope | Sender classification is not modified. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/session-auth-transport.test.mjs` | `mail-worker/scripts/reliability-tests/nexora-onboarding-orchestrator.test.mjs` | Mapped | Covered for provider callback | The new route test verifies the provider callback's public path is still state+PKCE+D1 authorized. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/ucs-checkpoint-monitor-identity.test.mjs` | `-` | Missing | Out of scope | UCS is explicitly not part of NEXORA callback PR review. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/ucs-high-watermark-completion.test.mjs` | `-` | Missing | Out of scope | UCS is excluded. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/ucs-outbox-drain-limit.test.mjs` | `-` | Missing | Out of scope | UCS is excluded. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/ucs-outbox-pool-workers-benchmark.test.mjs` | `-` | Missing | Out of scope | UCS is excluded. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/unified-conversation-system.test.mjs` | `-` | Missing | Out of scope | UCS is excluded. |
| `platform/cloud-mail/mail-worker/scripts/reliability-tests/workspace-management-os.test.mjs` | `-` | Missing | Out of scope | Workspace management OS is not modified. |

## Review Finding Closed During Reconciliation

P1: real provider callback GET routes were behind the global CloudMail application auth middleware, which would block an unauthenticated Google or Microsoft OAuth redirect before state correlation. Fixed by adding exact-path public callback exemptions for the two Provider callback URLs only. The callback route remains authorized by D1 callback correlation, OAuth state, PKCE verifier cookie, expected Provider, OIDC verification, callback claim lease, fencing token, token generation, Provider connection generation, Evidence Ledger, verifier authorization, and exact-once continuation.

## Final Inventory Decision

No missing outcome-critical integration-branch suite remains unmapped after the route-level callback test. The historical 53-file inventory remains immutable external evidence for checkpoint `5d7024d1cea12b6425727fdeb28885cfb83cdf7b`; the PR review candidate uses the remote-main integration layout and must be judged by the 13-file / 145-test integration suite plus this reconciliation.
