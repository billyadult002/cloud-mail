# NEXORA Checkpoint 5 Implementation Plan

## Maker-Checker loop

Maximum five iterations. Each Maker change must be followed by executable Checker verification and an independent adversarial review before production.

## Work sequence

1. [complete] Inventory canonical OAuth, refresh, authority, credential, provider, telemetry, and fail-open surfaces.
2. [complete] Inspect exact Comail v0.2.25 commit and record concepts-only reuse/licensing decision.
3. [complete] Write ADR-010 through ADR-014, executable contract, inventory, coverage, coupling, rollback, readiness, and unresolved reports.
4. [complete] Add and adversarially probe additive/idempotent migration 0081.
5. [complete] Implement Connection Runtime, Gmail adapter, Provider Session, callback integration, refresh recovery, and health evaluation.
6. [complete] Add focused contract and regression tests; retain existing exact-once/race matrices.
7. [complete] Run Worker suites, coupling guards, syntax, clean install, audits, dependency inspection, secret scan, and dry-run bundle.
8. [complete] Complete independent OAuth/security, migration/state, and provider-boundary re-review and resolve all P0/P1/P2.
9. [complete] Seal/push reviewed commits, open PR 10, apply reviewed migration 0081, and deploy exact reviewed source default-off.
10. [blocked] Domain Authority, exact canonical account binding, and the reviewed authenticated `mail_read` launch are live. Google rejects the callback as unregistered, and the exact OAuth client is not visible in any project accessible to the signed-in administrator.
11. [pending] After the canonical callback succeeds, prove one bounded read-only Gmail health operation, negative isolation, evidence integrity, and rollback while keeping automatic refresh disabled.
12. [complete] Apply reviewed migration 0082 to accept canonical account-owner authority generation zero and retain fenced Mission rebinding; verify exact production schema before retrying OAuth.
13. [complete] Deploy the reviewed orchestrator-owned canonical Mission run creation and retry the existing pending OAuth launch.
14. [complete] Repair the production-shaped Mission Claim insert used by Connection evidence. The retry reached `beginAuthorization`, created no provider call, and failed closed because the canonical production `mission_runtime_claims` table requires `step_id`, `claim_type`, `subject_hash`, `assertion_hash`, and `required_evidence_json`, while the Connection writer supplied only the simplified test-schema fields.

## Proposed iteration 5 repair

1. [complete] Extend the Connection evidence writer to populate the complete canonical Mission Claim contract and validate every `INSERT OR IGNORE` by rereading the exact claim/policy tuple before verification.
2. [complete] Add a production-shaped regression fixture using the deployed claim/policy schemas and the real canonical verifier, plus deterministic evidence replay and expired partial-operation recovery.
3. [complete] Bind each recovered internal operation attempt to the new Connection fencing token; retain an exact bounded cleanup for the single pre-repair orphan evidence row.
4. [complete] Run focused tests, the full Worker suite, syntax/coupling guards, audits, and an independent adversarial review. Final result: 21 files / 238 tests, zero audit findings, no remaining P0/P1/P2.
5. [complete] The reviewed service correction and migration 0083 are deployed with preserved bindings. The retry produced a generation-2 `AUTHORIZATION_PENDING` Connection bound to the fresh Mission, with a verified REAUTHORIZE receipt, zero provider calls, zero mailbox mutations, and automatic refresh still disabled.

## External Google OAuth blocker

- The canonical launch reaches Google Accounts and is rejected with `redirect_uri_mismatch`.
- Register exactly `https://cloud-mail.fastonegroup.workers.dev/v3/onboarding/providers/google/callback` on the existing OAuth web client that issued the request.
- The signed-in administrator can access multiple Google Cloud projects, but none contains that exact client. No substitute client was edited or created.
- After access to the owning project is granted, add only that redirect URI, relaunch the existing read-only flow, verify identity plus Gmail read-only scopes, and stop for any password, passkey, OTP, or CAPTCHA.

## OAuth expiry-normalization repair

1. [complete] Register the exact callback once on the proven existing Web client; preserve both prior redirect URIs and make no IAM, secret, JavaScript-origin, or consent-screen change.
2. [complete] Reproduce the bounded retry after the prior session's recorded expiry and prove that direct ISO-text versus `CURRENT_TIMESTAMP` comparison leaves the expired session falsely live.
3. [complete] Normalize all five authorization-session binding/recovery/replay comparisons with millisecond-safe SQLite `julianday(...)`; add production-shaped semantic regressions for same-day ISO expiry, live sessions, expired replacements, and malformed timestamps.
4. [complete] Focused regression 4/4, full Worker reliability 21 files / 240 tests, syntax, SQLite integrity, Connection/provider coupling, and both audits pass. Independent re-review reports no remaining P0/P1/P2.
5. [complete] Exact reviewed commit `86cac62667e6f7f68d69bc2f9084677c203d200b` remains deployed at 100% with bindings preserved and refresh disabled. The administrator completed local account selection and Google consent; the resulting callback was not accepted because its bounded authorization session had expired.
6. [complete] Correct the post-recovery exact-once binding: recovery does not consume the replacement session's unique operation reference before `beginAuthorization`; an expired authorization-bound operation retains immutable lineage, retires, and requires a new session, while only sessionless operations may retry. The real partial unique index plus authority-immutability trigger, focused 6/6, full 242/242, guards/audits, and independent re-review pass with no P0/P1/P2.
7. [blocked — P0 exposure stop] Google consent returned only after the ten-minute session expired, so the callback was not consumed and no token exchange or health operation occurred. The callback query was then exposed in ambient browser state/page title. Stop production acceptance, close the exposed callback tab, retain refresh and provider writes disabled, and require a separately reviewed containment/retry decision before creating another authorization session.

## Approved bounded retry after P0 containment

1. [complete] Confirm the exposed callback cannot be consumed: all prior Google authorization sessions are time-expired, the callback ledger has no verified result, and no Provider Connection, credential reference, Provider Session, Provider call, or mailbox mutation exists.
2. [complete] Confirm production drift is absent: Worker version `4fa31aae-6918-4e68-9d5e-a57d0e40a7e0` remains at 100%, migrations are current, exact Google/tenant/workspace/account allowlists remain active, and automatic refresh remains disabled.
3. [complete — independent GO] Approve exactly one new ten-minute read-only authorization session against the existing Connection. The Independent Checker found no P0/P1/P2 and confirmed the old callback is non-consumable, with no credential/provider side effects. The old callback/code must never be replayed or exchanged; no replacement Connection, OAuth client, deployment, migration, or Google configuration change is permitted.
4. [blocked on immediate human account selection] One new bounded session launched at `2026-07-23T13:16:00Z` from the authenticated Domain Activation surface with explicit Workspace 1 and read-only Gmail approval. The existing Connection advanced through reviewed expired-session recovery to `AUTHORIZATION_PENDING` generation 8; exactly one pending session is currently consumable, with zero Provider calls and mailbox mutations. Google requires stored-account selection, so the preserved chooser is handed to the administrator for local action.
5. [blocked — consent screen bypassed] The administrator completed consent before Codex could inspect the non-secret consent metadata. The returned scope set was not independently classified at the consent-screen checkpoint, so scope verification remains incomplete even though the callback metadata described only identity and Gmail read-only scopes.
6. [blocked — repeated P0 exposure] Consent completed within the bounded window, but the complete callback query was again injected into ambient browser state. The callback tab was closed immediately without replay or further browser inspection. The authorization session was consumed once and one token-exchange response was durably observed, but no Provider outcome, credential reference, Provider Connection, callback verified result, or Connection transition was committed.
7. [pending] After callback, require exact-once consumption, one opaque credential reference, one bounded non-mutating Gmail health operation, canonical Evidence plus independent Verification, zero mailbox mutation/write/watch/delta, and automatic refresh still disabled.
8. [complete — stopped] The repeated sensitive-query exposure and post-exchange/pre-persistence ambiguity triggered the mandatory stop. No health operation, recovery, replay, or additional OAuth session is permitted in this run.
9. [complete — independent NO-GO] The Independent Checker confirmed the P0 exposure stop and identified two unresolved P1s: the post-exchange/pre-persistence state has no canonical Provider outcome and is unsafe to recover in this run, and the consent screen was bypassed so returned callback metadata is not independent scope proof.

## Stop conditions

- Any credential/token/code disclosure, cross-scope ambiguity, unreviewed production source, destructive migration, mailbox mutation, provider-write path, second callback runtime, second authority owner, or unverifiable provider outcome stops production work immediately.
- If no live provider operation is safely possible, retain `CHECKPOINT_5_LOCAL_CONNECTION_RUNTIME_PASS — LIVE_PROVIDER_ACCEPTANCE_NOT_COMPLETE`.
- If refresh recovery cannot be safely demonstrated, retain `CHECKPOINT_5_PROVIDER_CONNECTION_PASS — RECOVERY_ACCEPTANCE_INCOMPLETE`.
- If callback, refresh, or credential-boundary risk remains unresolved, retain `CHECKPOINT_5_PRODUCTION_READINESS_BLOCKED`.
# Production OAuth launch closure

- Add one authenticated Domain Activation control that becomes available only after the verified Domain Authority is established.
- Resolve the signed-in actor's exact canonical account from the existing authenticated account list; do not hardcode a mailbox identifier in the browser.
- Start `/v3/onboarding/start` with provider `google`, capability `mail_read`, the exact Workspace/account tuple, and owner authority generation `0`.
- Reject any authorization response that is not an HTTPS Google Accounts URL.
- Add a request-contract test that fails if write scopes or mailbox-mutation capabilities enter the launch request.
- Re-run frontend and Worker verification, inspect the diff adversarially, deploy the reviewed source, and continue only through visible Google consent.
- Treat an OAuth replay envelope and a verified Connection Runtime authorization receipt as separate authorities; retry incomplete expiry recovery instead of poisoning an idempotency key.
- Rebind replacement Missions only within the claimed/fenced verified transition.

## Checkpoint 5R OAuth confidentiality and exchange recovery

1. [complete] Preserve and re-read the production STOP state without creating a session or invoking Google.
2. [complete] Inspect authorized Comail revision and record evidence-backed no-reuse decision.
3. [complete] Write ADR-015 through ADR-018 and revised callback/session/receipt/recovery contracts.
4. [complete] Implement migration 0084, encrypted callback intake/clean redirect, durable scheduled consumer, manifest gate, sealed exchange receipt, exact-once fenced recovery, and plugin isolation guards.
5. [complete] Focused crash/tamper/browser/scope tests, real-migration repeatability, full Worker regression, audits, scans, production dry-run bundle, and coupling guards pass.
6. [complete] Independent checker and OAuth security reviewer both report PASS with no remaining P0/P1/P2 after six adversarial rounds.
7. [complete] Evidence committed and pushed to PR 10 without deployment, production migration, or live OAuth.
8. [complete] Document the bounded one-session retry proposal and retain a separate explicit human approval gate.
# NEXORA Capability Convergence Remediation Plan

Authority is limited to `/Users/billtin/Documents/cloudmail/.worktrees/nexora-checkpoint5-connection-runtime`, branch `codex/nexora-checkpoint5-connection-runtime`, PR #10. The dirty root remains frozen. Maximum Maker-Checker iterations: 5.

1. Reuse the accepted Capability-Native ADRs and canonical `search_email` descriptor. Do not import the five-verb contract, its invocation envelope, Google service adapter, best-effort authority-event evidence, or self-declared result states.
2. Make the canonical Evidence writer own Evidence identity and reject exceptions, zero-row writes, malformed persistence results, and integrity mismatches.
3. Separate Verification into its own canonical service. It must independently validate durable Evidence, scope, request/result digests, safety flags, canonical source identity, adapter identity, and write exactly one checked Verification row; rejected or failed verification cannot return caller success.
4. Add an immutable production construction path that supplies the canonical Registry, Authority, Evidence writer, verifier, and Gmail synchronized-D1 adapter. Keep dependency injection available only to explicitly named test construction.
5. Harden the Gmail adapter so D1 result envelopes, rows, account/actor scope, source identity, opaque message identifiers, cardinality, and safety metadata fail closed when malformed or substituted.
6. Keep exactly one integrated caller: `scheduled-capability-runtime-service.js`. Require checked state transitions and a durable verified outcome before returning success. Do not migrate any other caller or enable `get_delta`, watch, send, OAuth, or Provider execution.
7. Extend the provider-coupling guard across every production module in the path; permit provider-specific identifiers only in the adapter and reject direct Provider/token/credential/email-service access, fabricated Evidence, and constructed verified state in caller/invocation layers.
8. Verify with focused Cloudflare/Vitest tests, the exact full PR #10 Worker suite, syntax and coupling guards, dependency audits, a changed-file secret scan, migration integrity, Wrangler dry-run bundle, and `git diff --check`.
9. Submit the final diff and executable evidence to one isolated Checker with no write ownership. Resolve every P0/P1/P2 before commit and push.

Human checkpoint: the attached Mission already explicitly authorizes this bounded plan, commit, and PR #10 push. No staging or production authorization is inferred.
