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
10. [in progress] Domain Authority and exact canonical account binding are verified. Seal and deploy the reviewed authenticated `mail_read` launch, then stop at any password/OTP/passkey boundary for local user entry.
11. [pending] After the canonical callback succeeds, prove one bounded read-only Gmail health operation, negative isolation, evidence integrity, and rollback while keeping automatic refresh disabled.
12. [complete] Apply reviewed migration 0082 to accept canonical account-owner authority generation zero and retain fenced Mission rebinding; verify exact production schema before retrying OAuth.
13. [complete] Deploy the reviewed orchestrator-owned canonical Mission run creation and retry the existing pending OAuth launch.
14. [complete] Repair the production-shaped Mission Claim insert used by Connection evidence. The retry reached `beginAuthorization`, created no provider call, and failed closed because the canonical production `mission_runtime_claims` table requires `step_id`, `claim_type`, `subject_hash`, `assertion_hash`, and `required_evidence_json`, while the Connection writer supplied only the simplified test-schema fields.

## Proposed iteration 5 repair

1. [complete] Extend the Connection evidence writer to populate the complete canonical Mission Claim contract and validate every `INSERT OR IGNORE` by rereading the exact claim/policy tuple before verification.
2. [complete] Add a production-shaped regression fixture using the deployed claim/policy schemas and the real canonical verifier, plus deterministic evidence replay and expired partial-operation recovery.
3. [complete] Bind each recovered internal operation attempt to the new Connection fencing token; retain an exact bounded cleanup for the single pre-repair orphan evidence row.
4. [complete] Run focused tests, the full Worker suite, syntax/coupling guards, audits, and an independent adversarial review. Final result: 21 files / 238 tests, zero audit findings, no remaining P0/P1/P2.
5. [in progress] The first reviewed repair was deployed with preserved bindings. The retry exposed an ISO-expiry Mission-rebind boundary; the final guarded correction now proves every pending prior-Mission session is parseable and expired, rejects any live sibling, and remains limited to credential-free/provider-free DISCOVERED Connections. Deploy the final reviewed commit with `--keep-vars --env=""` and resume Google read-only consent.

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
