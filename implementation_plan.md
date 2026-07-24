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
# NEXORA Secure Staging Authority Bootstrap — Implementation Plan

## Decision

Add a narrow staging-only bootstrap capability that creates only the missing canonical configuration baseline. It will not create users, workspaces, accounts, provider grants, connections, credentials, or OAuth sessions.

## Planned changes

1. Add staging-only migration `staging-migrations/0085_nexora_secure_staging_bootstrap.sql`, applied only with an explicit staging migration directory.
   - Create the final canonical `setting` table shape when absent.
   - Add a guarded bootstrap-operation ledger for single-winner, replay-safe state.
   - Add constraints/triggers needed to prevent deletion or invalid terminal-state rewrites.
   - Do not seed authority records in the migration.

2. Add a dedicated secure bootstrap service.
   - Require staging environment plus an explicit enable flag.
   - Authenticate with a dedicated `NEXORA_STAGING_BOOTSTRAP_SECRET` binding.
   - Accept the credential only in a `POST` body; return `no-store`/`no-referrer` responses.
   - Compare credential digests without echoing or logging input.
   - Enforce zero-user, zero-account, zero-workspace, zero-setting, and uncompleted-operation predicates in the committing D1 batch.
   - Insert the single canonical setting row and database receipt exactly once.
   - Refresh settings into KV after D1 commit.
   - If KV refresh fails, retain a redacted recoverable `DB_COMMITTED` state; an authenticated retry may finish KV and mark `COMPLETE` without reinserting the setting.
   - Deny all mutation after `COMPLETE`.

3. Harden initialization routing.
   - In staging, deny legacy `GET /init/:secret` before reading or comparing its parameter.
   - Add a minimal staging-only secure form and `POST /init/secure` handler.
   - Preserve legacy behavior outside staging to avoid unrelated compatibility changes.

4. Add focused verification.
   - Missing/wrong secret and production denial.
   - Legacy URL-secret denial in staging.
   - Exact precondition failures with zero writes.
   - One successful bootstrap with exactly one setting row.
   - Concurrent invocation with one winner.
   - Replay denial.
   - KV failure and authenticated recovery.
   - No credential exposure in response, logs, receipts, or durable rows.
   - Foreign-key and ledger guard integrity.

5. Add an ADR documenting:
   - why URL-secret initialization is prohibited;
   - the one-shot staging credential boundary;
   - D1/KV commit and recovery semantics;
   - post-success disablement and secret deletion;
   - why canonical authority must still be created via normal UI flows.

## Verification and release sequence

1. Maker implements the smallest patch in the isolated worktree.
2. Checker runs focused Cloudflare/Vitest tests, applicable regression tests, lint/static checks, migration checks, and reviews the complete diff adversarially.
3. Iterate at most five times until all gates pass or report the exact blocker.
4. Apply migration `0085` to the exact staging D1 through the staging binding's `migrations_dir = "staging-migrations"` and verify schema with SELECT-only evidence; it is excluded from the shared production migration chain.
5. Deploy the reviewed exact source to staging only, preserving existing variables and recording the observed Worker version.
6. Human locally creates and enters the dedicated bootstrap secret into the masked Cloudflare binding and secure form; Codex does not read or transcribe it.
7. Verify one `READY_FOR_FIRST_AUTHORITY` bootstrap receipt, one setting row, KV readiness, zero authority rows, and zero OAuth sessions.
8. Human uses the same locally held secret as the first normal registration code; verify the exact single user/account checkpoint.
9. Because no existing workspace-create API exists, use the credentialed completion form to atomically create the sole canonical workspace/OWNER membership and prove the relational user→account→membership→workspace tuple.
10. Only after `COMPLETE`, disable the bootstrap and remove the dedicated secret, then prove replay denial.
11. Independently verify the canonical authority tuple before starting one Google OAuth read acceptance.

## Human checkpoint

Implementation, migration, deployment, and secret-entry steps remain paused until this plan is explicitly approved.

---

# Implementation Plan — Brokered Delegated Authority Convergence

## Canonical decision

Amend the existing credential and Provider Session ADRs with one canonical Brokered Delegated Authority ADR. Reuse Connection Runtime, Credential Reference, Provider Session, Capability Invocation, Verified Action Boundary, Provider Adapter, Evidence Ledger, and Verification. Do not create a second runtime, registry, evidence system, or authority owner.

## Checkpoint 1 — contracts and classification

1. Add the canonical ADR and classify human, device, provider, platform-secret, machine, Bridge, and workload credentials.
2. Define policy decision versus credential delivery, trusted-device broker, OAuth delegation, managed secret, machine identity, Proton/Bridge, human escalation, revocation, recovery, and metadata-only evidence.
3. Add a provider capability constraint matrix. Unsupported capabilities fail closed as `UNAVAILABLE`, `HUMAN_PRESENCE_REQUIRED`, or `TRUSTED_DEVICE_UNAVAILABLE`.

## Checkpoint 2 — brokered Provider Session

1. Extend the existing Provider Session service as the only credential-delivery boundary.
2. Require canonical authority and exact tenant, workspace, domain, account, Mission/run/step/action, capability, connection generation, operation lease/fence, and credential/provider generations.
3. Issue a non-serializable single-capability session with explicit issuance, expiry, digest identity, maximum lifetime, call limit, close, and revocation checks.
4. Deliver credentials only inside adapter closures. Mission, request, evidence, verification, and logs receive references/digests only.
5. Preserve AES-GCM storage and generation-fenced refresh; add exposure, cross-scope, replay, expiry, and revocation tests.

## Checkpoint 3 — trusted device broker

1. Add a narrow iOS AuthenticationServices broker for Passkey and Password AutoFill ceremonies; private material remains Apple-managed.
2. Add Associated Domains only for the exact staging relying-party domain and verify its server association artifact.
3. Store only application session/reference material in Keychain with an explicit accessibility policy.
4. Add WebAuthn challenge/assertion verification with RP ID, origin, challenge, credential, sign counter, actor/workspace binding, expiry, and replay protection. Persist only public credential material and redacted evidence.
5. Return a resumable human-presence checkpoint and automatically continue the exact Mission after assertion.

## Checkpoint 4 — autonomous lifecycle

1. Converge scheduled refresh, Connection health/recovery, sync recovery, and Mission continuation under the same Connection and Provider Session fences.
2. Add Watch/Subscription lifecycle as typed provider state. Implement only where provider contract and granted scopes support it; otherwise expose explicit unavailable/permission-expansion state.
3. Add a least-privilege staging Machine Service Identity boundary for scheduled/internal operations. Keep secret values only in Cloudflare Secrets/Secrets Store with environment scope, rotation, expiry, revocation, and audit metadata.
4. Prove refresh, failure classification, backoff, lease recovery, sync restart, renewal, continuation, and revocation without human participation.

## Checkpoint 5 — Proton and constrained providers

1. Model Proton Bridge as device/Bridge-bound and content-inaccessible without its trusted runtime.
2. Never upload Proton passwords, Bridge credentials, keys, or decrypted content.
3. Emit metadata-only evidence and fail safely when the trusted device or Bridge is unavailable.

## Verification and release

1. Maker adds focused tests before each bounded change.
2. Checker runs Cloudflare/Vitest, iOS tests, schema/migration proofs, syntax/lint, exposure scans, and dependency/security audits.
3. An independent adversarial reviewer reports every P0/P1/P2; findings loop back to Maker, up to five iterations.
4. Deploy only the reviewed exact commit to staging and record migration IDs, Worker version, bindings, secret names only, and SELECT-only redacted state.
5. Run staged lifecycle tests with synthetic metadata and an existing authorized connection only when canonical authority exists. Never imply consent or expand scope.
6. Use Xcode Beta to build, install, launch, and run the acceptance harness on the paired physical iPhone. User presence remains local.

## Rollback

- Disable new session issuance server-authoritatively.
- Revoke new Machine Identity and Provider Sessions while preserving append-only Evidence.
- Roll back Worker to the prior observed version.
- Remove only newly introduced staging secrets/bindings after confirming no active dependency.

## Approval boundary

Code, migration, Cloudflare, Google, and device mutations remain paused pending explicit approval. Expected human actions are limited to irreducible local Passkey/biometric/Provider consent or permission expansion. Final PASS remains blocked until every checkpoint has direct evidence.

---

# Implementation Plan — Autonomous Staging Authority Tuple and OAuth Client Provenance

## Narrow canonical amendment

The existing models cannot complete this Mission unchanged. Add one staging-only, one-shot Authority Tuple ceremony and amend the existing account-delegation scope allowlist to represent `mail_read`. Reuse all existing authority, audit, Evidence, and Verification tables and services. Do not reactivate or reuse the retired secure bootstrap.

## 1. Authority Tuple ceremony

1. Add a staging-only service guarded by environment identity, exact bootstrap state `READY_FOR_FIRST_AUTHORITY`, exact zero-count predicates, version/generation fences, and a dedicated short-lived authority-operation credential.
2. Generate that credential with OS entropy, keep it in process memory, write it to a new Cloudflare staging Secret through stdin, invoke the one-shot POST once, then delete the Secret and disable the ceremony.
3. Use one immutable operation with two fenced, individually atomic phases. Phase A creates the identity/Workspace authority required to issue a canonical DNS challenge. After DNS verification, Phase B creates:
   - one synthetic non-sensitive User and legacy account identity;
   - one Tenant with a deterministic tenant key;
   - one Workspace;
   - one OWNER Membership plus canonical Membership Authority;
   - one verified Domain binding derived from canonical DNS ownership evidence;
   - one Google Gmail Account onboarding row and Workspace binding, with no password, token, credential reference, OAuth state, or provider connection;
   - one active `mail_read` Delegation Authority bound to the same owner/subject, account, tenant, workspace, domain, and current authority generation;
   - Authority Audit, redacted Evidence, separate Verification, operation receipt, tuple digest, and rollback metadata.
4. Require every phase to commit atomically, and never mark the operation `COMPLETE` until the full tuple exists and verifies. Any zero-row, duplicate, cross-scope, stale-generation, or overbroad-capability condition aborts the active phase.
5. Replays return the same completed tuple digest without writes; concurrent requests have exactly one winner.

## 2. Domain ownership

1. Use the existing DNS challenge and Domain Authority path.
2. Select a staging-only subdomain under an already controlled test zone; create only the exact temporary TXT challenge through scoped Cloudflare authority if permission exists.
3. Verify DNS through the canonical server path and derive Domain Authority from the resulting verification event.
4. Do not infer verification, use a reserved fake TLD, or treat an Account row as ownership evidence.
5. Preserve the verification record; remove only the temporary TXT record after verification if the canonical contract permits it and record rollback evidence.

## 3. Least-privilege delegation amendment

1. Add `mail_read` to the existing Delegation Authority contract only.
2. Reject send, delete, write, watch, delta, refresh, draft, administrative, wildcard, and unknown scopes.
3. Bind the delegation to the exact Account and current Membership/Domain authority generations.
4. Add missing-membership, wrong-tenant/workspace/domain/account, stale-generation, expiry, revoke, replay, and concurrency tests.

## 4. Google OAuth client provenance — read only

1. Inspect the authenticated Google Cloud console without changing configuration.
2. Record only project fingerprint, client ID fingerprint, client type, registered staging redirect URI status, client usage/sharing assessment, and access result.
3. Correlate the visible Client ID fingerprint with the staging binding through a purpose-built redacted runtime diagnostic that hashes the binding inside the Worker boundary; never output the Client ID or Secret.
4. Confirm the Client Secret only by binding name/type presence. Never read, reset, copy, or replace it.
5. Do not create an OAuth URL/session or call Google/Gmail APIs.

## 5. Verification and release

1. Maker writes focused tests first and implements the smallest patch.
2. Checker runs Cloudflare/Vitest suites, migration repeat-apply and rollback proofs, schema/foreign-key checks, syntax/lint, secret-pattern scan, and security audits.
3. Independent adversarial review reports every P0/P1/P2; iterate at most five times.
4. Deploy only the reviewed exact commit to staging and record the Worker version.
5. Execute the one-shot ceremony, disable it, delete its temporary Secret, and prove replay denial with SELECT-only D1 evidence.
6. Verify production Worker/version and production state remain unchanged.
7. Stop with `HUMAN_AUTHENTICATION_CHALLENGE_REQUIRED — MINIMUM_LOCAL_INTERACTION_ONLY` only if Google Console requires an irreducible local challenge.

## Rollback

- Before execution: remove the new Secret/binding and deploy the prior staging Worker.
- After an incomplete transaction: D1 must have zero tuple writes; remove the challenge TXT and restore the prior Worker.
- After completed tuple creation: use the recorded canonical revocation/rollback operation, never destructive ad-hoc deletes, and preserve Audit/Evidence/Verification.
- Production is never a rollback target.

## Approval boundary

Implementation, migration, DNS, Cloudflare configuration, staging deployment, and tuple creation remain paused until this plan is explicitly approved. Google inspection remains read-only and no OAuth session is authorized.

## Checker loop checkpoint — 2026-07-24

- The first three Checker rounds drove remediation of domain validation/HMAC provenance, expiry, separate verification, exact authority bindings, staged completion/revocation, minimum brokered scope, runtime Secret non-access, independent digest recomputation, canonical-row verification, revocation Evidence/Verification, runtime enforcement of brokered `mail_read`, and tamper/atomic-failure coverage.
- Local stop conditions are green: focused authority plus scheduled runtime 36/36, RC 24/302, unit/syntax, coupling guards, OAuth artifact guard, dependency audit, migration repeatability, and diff check.
- Fifth independent Checker review passes with no remaining P0/P1/P2 in the implementation diff.
- External mutation remains gated on final independent Checker approval and exact Google Web-client provenance. Current read-only Console evidence does not establish the expected Web client under the available project view; therefore migration/deploy/tuple creation remains intentionally unstarted.

## Google authority boundary closure — 2026-07-24

- Google Console read-only access now establishes project `nexora-503322`, Web application OAuth client `151318451585-6lfu68126phbtudkg773eu0bmtv1t549.apps.googleusercontent.com`, and exact registered staging redirect `https://cloud-mail-staging.fastonegroup.workers.dev/v3/onboarding/providers/google/callback`.
- Cloudflare read-only inventory establishes the canonical OAuth binding names and `secret_text` type without secret disclosure.
- Repository and Worker configuration establish that the OAuth launch/token path consumes only those canonical binding names and that the reviewed provenance route reports redacted fingerprints only.
- Live staging still runs version `83c0b7a8-cc21-4324-91ff-b4640ca9bd39`, so the next non-Google proof step is to deploy reviewed commit `2038fdd8f84f4c1e467c4aa1e64709fc8c34e70b`, enable the verifier path under a temporary verifier secret, call `/init/authority-tuple/oauth-provenance`, and compare redacted fingerprints/origin/path to the Google Console evidence.
- No Google expansion remains required. The active verdict for this checkpoint is `VERIFIED_PROVENANCE_READY`.
