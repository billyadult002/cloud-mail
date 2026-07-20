# NEXORA P0 Hardening Implementation Plan

Human approval: `APPROVED_2026-07-19`

1. Reproduce P0s with real D1 negative, race, replay, and failure-injection tests.
2. Make domain claim/challenge/evidence/audit atomic and owner-immutable; harden bootstrap evidence
   provenance, revocation fencing, replay, and audit atomicity.
3. Derive classification scope from actor and canonical server email/account/workspace records.
4. Add migration `0079` with immutable runs/events/evidence, integrity/linkage, atomic writer,
   idempotency, authority snapshots, and actor-scoped BODYLESS retrieval.
5. Add server-issued, expiring, one-time runtime acceptance correlation bound to actor, workspace,
   account, platform, build, runtime release, message, classification, evidence, and server time.
6. Integrate browser/macOS and physical-iPhone normal product flows with clear accessible status;
   screenshots remain auxiliary only.
7. Run unit/RC tests, DB concurrency/failure injection, client builds/tests, lint/check, dependency
   audit, secret scan, Security Review, and independent Checker review.
8. Update ADRs and P0 closure reports. Stop at `ACTIVATION_READY_PENDING_PRODUCTION_EXECUTION` only
   if P0/P1 count is zero and every required test/review passes.

## Workspace Authority Resolution and Correlation Configuration Completion

Human approval: `APPROVED_BY_MISSION_2026-07-19`

Maximum Maker–Checker iterations: 5.

1. Add a strictly read-only, actor-scoped workspace listing/selection model. Never call the
   mutating `ensureDefault()` resolver for discovery. Bind the explicit human selection to the
   authenticated actor/session and require server-side `domain:write` revalidation.
2. Establish the production NEXORA admin session through the normal Cloud Mail login UI and
   preserve only redacted actor/tenant/workspace/role/session-reference evidence.
3. Add `[version_metadata] binding = "CF_VERSION_METADATA"` and a shared fail-closed deployment
   identity helper used by Domain Ownership and Runtime Correlation.
4. Replace short fingerprints and `SHA256(secret || value)` with a dedicated, versioned,
   domain-separated HMAC-SHA-256 helper. Remove every JWT-secret fallback from production
   authority/correlation evidence.
5. Close Runtime Correlation lineage gaps: bind consume/readback to the issuing auth session and
   active Worker version; require the exact acceptance session on classification run/event;
   verify projection, current event, current Evidence row/digest and ledger head before consume;
   recompute receipt digests on readback; reject client-controlled request identity.
6. Define a reviewed build manifest. Resolve iPhone project regeneration drift (`303` versus
   actual signed Release build `357`, version `3.03`). Define Desktop identity from the immutable
   reviewed release artifact/merge SHA. Treat label allowlisting only as a configuration gate;
   preserve artifact/signing/installation attestation separately.
7. Add negative, isolation, idempotency, replay, rollover, tamper, digest, allowlist revocation,
   cross-session and attestation tests. Run Worker, SQLite, Web, Swift, simulator, audit and secret
   scans in the Checker phase.
8. After code/config review, provision only the dedicated correlation secret and non-secret build
   policy. Do not deploy, migrate, activate DNS, bootstrap authority, classify, or generate
   production evidence in this Mission.
9. Update ADR, Security Review, Checker Review, Workspace/Admin/Correlation reports and final
   readiness audit. Status may reach `ACTIVATION_READY_PENDING_DOMAIN_OWNERSHIP_EXECUTION` only
   when every gate passes; otherwise retain the existing blocked verdicts.

## Final execution record

Completed within three Maker–Checker iterations. Worker contracts/unit/SQLite/syntax PASS;
reliability 16 files/170 tests PASS; dependency audit 0; diff check PASS. Independent Security and
Checker reviews both PASS with P0 count 0. The local candidate reaches
`ACTIVATION_READY_PENDING_PRODUCTION_INPUTS_AND_EXECUTION`; deployed and device verdicts remain
unchanged until a separately authorized production mission supplies real activation evidence.
