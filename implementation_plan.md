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
9. [pending] Seal/push reviewed commit, open PR, review exact source, then apply reviewed migration and deploy default-off.
10. [pending] Complete human OAuth, bounded live Gmail health proof, production negatives, and rollback; otherwise retain the local-only verdict.

## Stop conditions

- Any credential/token/code disclosure, cross-scope ambiguity, unreviewed production source, destructive migration, mailbox mutation, provider-write path, second callback runtime, second authority owner, or unverifiable provider outcome stops production work immediately.
- If no live provider operation is safely possible, retain `CHECKPOINT_5_LOCAL_CONNECTION_RUNTIME_PASS — LIVE_PROVIDER_ACCEPTANCE_NOT_COMPLETE`.
- If refresh recovery cannot be safely demonstrated, retain `CHECKPOINT_5_PROVIDER_CONNECTION_PASS — RECOVERY_ACCEPTANCE_INCOMPLETE`.
- If callback, refresh, or credential-boundary risk remains unresolved, retain `CHECKPOINT_5_PRODUCTION_READINESS_BLOCKED`.
