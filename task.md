# NEXORA Checkpoint 5 Task State

## Capability convergence remediation — PR #10 canonical authority

- Mission: Canonical Capability convergence remediation for `search_email`.
- Implementation authority: this existing PR #10 worktree only.
- Initial HEAD: `61f04874b661f2c4cd72204c7ed5fc5a7a1af2af`.
- Canonical base: `cafe44eca4359911cfd773f0f262f3b4c37b9720`.
- Reference-only commits: `2a8f7c9`, `cae0c23`; neither may be merged or cherry-picked wholesale.
- Frozen root: preserved; the mandatory `repository_check.log` append is forensic evidence and is excluded from this worktree, staging, and commits.
- Maker-Checker iteration cap: 5.
- Current iteration: 2.
- Current phase: final publication after clean independent re-review.
- Authorized integrated caller: the existing scheduled read-only `search_email` caller only.
- Staging OAuth, Provider calls, mailbox operations, deployment, and remote database mutation: prohibited.

### Capability remediation gates

1. [complete] Establish unambiguous PR #10 worktree, branch, base, upstream, remote, and initial HEAD.
2. [complete] Classify the five-verb reference seam as non-canonical; retain mapping concepts only.
3. [complete] Harden canonical Authority, Evidence, independent Verification, production construction, adapter validation, replay, and caller completion.
4. [complete] Run focused and full canonical verification, audits, scans, dry-run bundle, migration checks, and diff checks.
5. [complete] Obtain an isolated adversarial Checker adjudication and resolve every P0/P1/P2; final verdict CLEAN.
6. [pending] Commit and push only this worktree's reviewed changes to PR #10.

- Mission: Provider-Agnostic Durable Connection Runtime and Gmail linking recovery
- Branch: `codex/nexora-checkpoint5-connection-runtime`
- Canonical base: `cafe44eca4359911cfd773f0f262f3b4c37b9720`
- Worktree: `/Users/billtin/Documents/cloudmail/.worktrees/nexora-checkpoint5-connection-runtime`
- Checkpoint 4 PR: merged as `cafe44eca4359911cfd773f0f262f3b4c37b9720`
- Maker-Checker iteration cap: 5
- Current iteration: 5
- Current phase: Checkpoint 5R local remediation and independent re-review; production remains stopped at generation 8
- Reviewed implementation commits: `4a778f5da1297850a713c8265b3d9480bdbd6fea`, `45dee5c5b0d81c70b6aba89403334fac55cf29f8`, `813520ca535a7922cd6eddd221be5e998577be45`, and migration commit `72487e97d77f614849856f4520fdee7e8d05a5e9`
- Pull request: `https://github.com/billyadult002/cloud-mail/pull/10`
- Production Worker version: `4fa31aae-6918-4e68-9d5e-a57d0e40a7e0`
- Production changes in Checkpoint 5: migration 0081, verified Domain Authority/account binding, and exact bounded runtime variables with refresh disabled
- Provider writes: 0
- Mailbox mutations: 0
- Secret disclosures: 0

## Hard boundaries

- Root checkout remains frozen and dirty; all implementation occurs in this worktree.
- Connection Runtime owns connection lifecycle only, not Mission authority, Evidence authority, credentials, or synchronization.
- Credentials remain opaque outside the short-lived Provider Session boundary.
- No send, draft, Gmail watch, get_delta, mailbox mutation, or real-time sync claim.
- No migration or deployment before exact-source local verification and independent review.

## Current gates

1. [complete] Quantitative architecture inventory.
2. [complete] Comail provenance and concepts-only reuse decision.
3. [complete] ADR-010 through ADR-014 and executable contract.
4. [complete] Additive D1 persistence and schema-preserving rollback artifact.
5. [complete] Runtime implementation; migration applies twice; 236/236 Worker reliability tests pass.
6. [complete] Independent security, migration, and provider-boundary re-review; no remaining P0/P1/P2.
7. [complete] Reviewed commits pushed; PR 10 open and mergeable; migration 0081 applied; exact reviewed Worker deployed default-off.
8. [blocked] Verified Domain Authority, exact account selection, migrations 0082/0083, the canonical run correction, and the production-shaped Mission Claim repair are live. Google reaches the OAuth server but rejects the unregistered callback URI; none of the projects accessible to the signed-in administrator owns the exact OAuth client.

## Local verification evidence

- Clean `npm ci`: pass.
- Unit/syntax suite: pass.
- Cloudflare/Vitest reliability: 20 files, 236 tests, all pass.
- Domain Activation frontend acceptance: 34 tests, all pass; Vite development build passes.
- Focused onboarding/Connection matrix: 63 tests, all pass.
- Migration 0082 populated rebuild: repeated apply passes; rows, foreign keys, index/trigger set, and unchanged trigger SQL are preserved; canonical owner generation zero passes only through a fenced verified transition.
- Canonical onboarding run: exactly one deterministic run is created and rebound only to the full Mission tuple; cancelled Mission replay is rejected.
- New Connection contract and Provider Session suites: 39 tests, all pass.
- Final adversarial focused matrix: 78 tests, all pass; no remaining P0/P1/P2.
- Production-shaped Connection claim/retry regression: the real canonical verifier runs twice and reuses exactly one deterministic evidence row and verification; expired partial operations are retired and replaced under the current Connection fence.
- Final Worker reliability suite after claim repair: 21 files, 238 tests, all pass; syntax/coupling guards and both audits pass; independent re-review reports no P0/P1/P2.
- Expired-Mission rebind correction: every pending prior-Mission session in the exact scope must have a finite expired timestamp; empty, malformed, live-sibling, credential-bearing, and provider-bound cases reject. Final suite: 21 files, 239 tests; independent re-review PASS with no P0/P1/P2.
- Provider coupling guard: pass; Connection coupling guard: pass.
- `npm audit` and production-only audit: zero vulnerabilities.
- Migration 0081 apply twice: pass; direct HEALTHY, self-asserted Verification, illegal transition, and cross-tenant child probes rejected.
- Wrangler dry-run bundle: pass after supplying immutable local build identity; no deploy occurred.
- Migration SHA-256: `3dbc5a0338667c296f9616bf0a5c6a5e70a66bf62446715c242711e18da85c6f`.
- Dry-run Worker `index.js` SHA-256: `b664de0e8b6ccbdc73323946eae3bcf6273e34c132882502a49ba00d2a62141b`.
- Changed-file credential-pattern scan: no matches.

## Production evidence

- Migration 0081 applied exactly once; subsequent migration listing reports no pending migrations.
- Post-migration Connection, operation, and event rows: 0; runtime/identity guard triggers: 17.
- Exact reviewed evidence head deployed: `7035d1908cdc67d4378c988722094e514401aee2`.
- Worker version: `9b143fab-4c10-48c1-b694-222f40bb2333`; it runs immutable commit `2176869ef1d55947be1180f8b2343b5f454a8106` and retains the exact production bindings.
- Exact provider/tenant/workspace/account allowlists are active; emergency disable is false and automatic refresh remains disabled.
- Workspace 1 was explicitly selected; DNS ownership and one Domain Authority are verified; one canonical account is selected.
- Remaining live blocker: Google read-only consent has not completed, so consumed authorization sessions, eligible Google token authorities, authenticated health evidence, and mailbox mutations remain 0.
- First launch evidence: one pending authorization session, zero Connection rows, and zero provider calls; migration 0081 rejected canonical owner generation zero before the Google redirect.
- Migration 0082 remote evidence: applied once; zero Connection/operation/event rows before and after, owner/operation generation-zero constraints present, 13 Connection guard triggers, foreign-key check empty.
- Second launch evidence: the reviewed Worker version is active with refresh disabled; retry created the deterministic canonical Mission run and one DISCOVERED Connection, then failed closed at `mission_runtime_scope_denied` before Google. Remote inspection shows one incomplete leased REAUTHORIZE operation, no canonical Connection claim, no provider call, and no mailbox mutation.
- Root cause: the Connection writer's simplified Mission Claim insert omitted production-required `step_id`, `claim_type`, `subject_hash`, `assertion_hash`, and `required_evidence_json`; the approved repair and bounded cleanup are recorded in `implementation_plan.md`.
- Repair verification: complete canonical policy/claim fields are inserted and reread fail-closed; evidence identity is deterministic and replay-safe; expired partial operations recover under a new fencing token. Deployment and bounded production cleanup remain.
- First repaired deployment: Worker version `13c5416b-2a73-49ce-9612-2753e6801b73` received 100% traffic with all bindings preserved and refresh disabled. The append-only guard correctly rejected deletion of the pre-repair evidence row, so no production evidence was removed.
- Third launch evidence: the prior authorization session was correctly rejected as expired; a fresh session then exposed `connection_mission_association_conflict` before Google. The final reviewed correction permits replacement only for a credential-free/provider-free DISCOVERED Connection when all pending sessions under the prior exact Mission scope are demonstrably expired.
- Fourth launch evidence: the deployed service guard passed, retired the expired partial operation, and produced one canonical verified Connection receipt with zero provider calls, but migration 0082's trigger rejected the final state transition because it allowed only a null prior Mission. Migration 0083 replaces only that trigger and binds the fresh Mission to the exact verified REAUTHORIZE operation, event, session, scope, and fence; positive, mismatched-session negative, and repeated-apply SQLite proofs pass with no reviewer P0/P1/P2.
- Migration 0083 applied successfully to the remote production database. The resulting Connection is `AUTHORIZATION_PENDING` at generation 2 with its lease released and bound to the fresh Mission; the verified REAUTHORIZE receipt retains zero provider calls and zero mailbox mutations.
- Final reviewed Worker version `5c5fadf3-35de-4816-abf1-1dd816594e58` receives 100% traffic with all seven Connection bindings preserved and automatic refresh disabled.
- Google launch now reaches Google Accounts and fails with `redirect_uri_mismatch` for the canonical CloudMail callback. The exact OAuth client was not found in any Google Cloud project accessible to the signed-in administrator, so no Google configuration was changed. Completion requires access to the owning project and registration of that single callback URI.
- Continuation evidence: the owning project is now proven by the OAuth client project-number prefix, the existing Web client is accessible, and the exact production callback was added once while preserving both prior redirect URIs. Reopening the client shows three redirect URIs and the target byte-for-byte.
- The first bounded retry correctly refused a duplicate live session. After the recorded expiry time passed, recovery still returned `connection_authorization_session_not_expired`. Remote D1 evidence showed ISO `T`/`Z` timestamps, while the recovery SQL compared them lexically to space-separated `CURRENT_TIMESTAMP`; the narrow repair normalizes all five Connection authorization-session binding/recovery/replay guards with millisecond-safe `julianday(...)`.
- Expiry repair verification: focused 4/4 and full reliability 21 files / 240 tests pass; syntax, SQLite integrity, Connection/provider coupling, and development/production audits pass. Independent checker re-review reports no remaining P0/P1/P2.
- First post-deploy recovery correctly retired the expired prior session and advanced the Connection to `REAUTHORIZATION_REQUIRED` generation 3 with zero provider calls, but begin authorization failed closed because recovery had consumed the replacement session's unique operation binding. The follow-up correction keeps recovery evidence bound to the prior/replacement pair through its idempotency key while reserving `authorization_session_id` exclusively for the begin/callback operation.
- Production-shaped testing with the real partial unique index and authority-immutability trigger also exposed that an expired authorization-bound partial operation cannot safely transfer its session binding. The final rule retires it without changing lineage and fails closed with `connection_authorization_operation_retry_requires_new_session`; only sessionless internal operations may retry under a new fence.
- Final exact-once repair verification: focused production-shaped suite 6/6, full Worker reliability 21 files / 242 tests, syntax, SQLite integrity, Connection/provider coupling, and both audits pass. Independent checker verdict: PASS with no remaining P0/P1/P2.
- Exact commit `86cac62667e6f7f68d69bc2f9084677c203d200b` is deployed as Worker version `4fa31aae-6918-4e68-9d5e-a57d0e40a7e0` at 100% traffic with all bounded Connection controls preserved and automatic refresh disabled.
- A fresh session now reaches the Google account chooser. Production state is `AUTHORIZATION_PENDING` generation 4 with its lease released, provider/credential generations 0, provider network calls 0, and mailbox mutations 0. The chooser did not contain the canonical administrator identity; the secure browser handoff is paused at “Email or phone” for local human sign-in.
- Authenticated-consent continuation revalidated the unchanged production pre-consent state, selected Workspace 1 explicitly, and launched a new ten-minute read-only OAuth session without creating another Connection. Google now shows a stored-account chooser with multiple identities. Because selecting a stored credential is part of the human authentication boundary, the chooser is preserved for the administrator to select the exact canonical identity locally; consent-screen scope inspection and callback acceptance have not yet occurred.
- The administrator completed Google consent, but the browser returned after the bounded authorization session had expired. Remote canonical state therefore remains `AUTHORIZATION_PENDING` at generation 6 with zero callback verified results, zero Provider Connections, zero opaque credentials, zero Provider network calls, and zero mailbox mutations; the remaining leased REAUTHORIZE operation is already time-expired. The complete callback query was exposed by ambient browser state/page title, including a single-use authorization-code parameter. Per the Mission's P0 exposure stop rule, production acceptance stopped immediately; no replay, token exchange, health operation, or further provider action was attempted.
- Independent Checker confirmation: the redacted production aggregates and stop record are internally consistent, the leased operation is time-expired, and the P0 exposure stop plus separately reviewed containment/retry decision are required. No contradictory state or secret-bearing repository diff was found.
- The workspace owner separately approved a new bounded OAuth retry. Pre-launch containment is confirmed: no prior session remains consumable, no callback was verified, no credential/provider state exists, the Connection remains generation 6, and all runtime controls remain unchanged. The retry plan permits one new ten-minute read-only session on the existing Connection, requires completion within five minutes, forbids replay of the exposed callback, and awaits independent review before launch.
- Independent pre-launch verdict: GO with no P0/P1/P2, limited to the documented single-session/read-only/human-auth/exactly-one-health-call boundary and immediate stop on expiry, exposure, ambiguity, or possible second Provider call.
- The single approved retry launched at `2026-07-23T13:16:00Z`. Reviewed recovery retired the prior expired operation and rebound the existing Connection at generation 8; one authorization session is live, Provider/credential generations remain zero, and Provider calls/mailbox mutations remain zero. The Google stored-account chooser is preserved for immediate local administrator selection; Codex did not select a stored credential or inspect authentication material.
- The administrator completed consent directly, bypassing the requested stop at the consent-screen review checkpoint. The complete callback query was again exposed through ambient browser state, triggering the approved retry's immediate P0 stop; the callback tab was closed without replay. Production aggregates show exactly one consumed authorization session and a single observed token-exchange response checkpoint, but no Provider outcome, opaque credential, Provider Connection, callback verified result, or Connection transition. The Connection remains `AUTHORIZATION_PENDING` generation 8; no health call, mailbox mutation, watch, delta, synchronization, automatic refresh, or Provider write followed.
- Independent post-callback verdict: CONFIRMED STOP / NO-GO. Beyond the repeated-query P0, unresolved P1 findings are the post-exchange/pre-persistence ambiguity with no canonical Provider outcome, and the missing independent consent-screen scope verification. Recovery, replay, another session, and production acceptance are prohibited in this run.

## Checkpoint 5R remediation status

- Production remains `AUTHORIZATION_PENDING`, generation 8; no new authorization session or provider operation was created.
- Callback confidentiality root cause and exchange-to-commit ambiguity are documented under `docs/oauth-remediation/`.
- Maker iteration adds fixed queryless callback redirects, uniform cookie clearing/security headers, a two-minute encrypted durable callback intake, scheduled recovery, a versioned exact read-only Google scope manifest, additive migration 0084, and a short-lived sealed exchange receipt with current-claim fencing.
- Failure injection after the sealed provider response, credential commit, and Provider Connection commit passes exact-once recovery locally: one provider exchange, credential generation one, and terminal ciphertext tombstoning.
- Adversarial iteration 2 closed scheduled-intake recovery, stale intake fencing, exchange-insert loser, live Connection/authority commit-predicate, verified-result trigger, and unsealed-attempt expiry findings. Production platform-log cleanliness remains a disabled-deployment verification item, not a current live claim.
- Adversarial iteration 3 identified and closed the remaining live-source authority race: the session now binds Domain Authority generation and exact owner/delegation/membership authority, and every exchange/token/provider/finalization boundary rechecks the non-deleted Account, active Workspace authority, and verified non-revoked Domain Authority in D1. Account deletion, delegation revocation, and Domain generation/revocation tests leave the cached Connection unchanged and still fail closed.
- Adversarial iteration 4 closed the in-flight response-seal and final Connection-transition windows. Revocation rolls back the ciphertext/checkpoint/status batch, and `CONNECTED` requires the exact pending exchange, verified result, Credential Reference/generation, and Provider Connection/generation. A durable `LEGACY` versus `CONNECTION_RUNTIME` discriminator preserves the disabled-runtime path; the real migration SQLite proof covers both.
- Local isolated system-Chrome confidentiality proof passes: final and navigation URLs are queryless/fragmentless, back navigation skips the callback query, referrer is empty, no subresources load, fixture values are absent from HTML, and no-store/no-referrer/CSP headers are present. This is not production logging evidence.
- Final local verification passes: focused security/orchestrator 48/48; full Worker release 22 files / 267 tests; unit/syntax checks; production-migration SQLite repeatability and runtime-mode compatibility; OAuth artifact, Provider coupling, and Connection coupling guards; clean-install evidence; dependency audit with zero vulnerabilities; changed-diff sensitive credential scan; and exact-source production dry-run bundle at 2430.93 KiB / gzip 520.12 KiB for source commit `bf416af9850c45a5d756d93319aaa9f302078d78`.
- Independent Checker and OAuth security reviewer both report PASS with no remaining P0/P1/P2 after the sixth review round.
- Pre-production remediation gates are complete. Production remains stopped: migration 0084 was not applied, no Worker was deployed, no OAuth session/retry/provider call was created, and platform-log cleanliness is not claimed. Any exact one-session retry still requires a separate explicit human approval.
# NEXORA Secure Staging Authority Bootstrap — Modification Authorization

## Authorization and boundary

- Human authorization received on 2026-07-23: modify the narrowly scoped staging authorization/bootstrap implementation.
- Target: establish the missing canonical legacy `setting` baseline securely so the existing UI can create the first real user/workspace/provider authority through normal flows.
- Staging only. Production, existing authority semantics, OAuth client inventory, and unrelated runtime behavior remain frozen.
- Never place a credential in a URL, repository, chat, logs, screenshots, receipts, or committed configuration.

## Verified starting state

- Staging D1 contains the canonical user/account/workspace/role/permission tables, with zero users, accounts, workspaces, connections, and OAuth sessions.
- The `setting` table is absent; the UI consequently reports `Database not initialized`.
- The only existing initializer is `GET /init/:secret`, which compares a URL path value with `jwt_secret`. It is prohibited for this mission and has not been invoked.
- Checkpoint status remains:
  `STAGING_OAUTH_BLOCKED — SECURE_DATABASE_BOOTSTRAP_REQUIRED`

## Acceptance gates

- A staging-only, explicitly enabled, one-shot `POST` bootstrap path uses a dedicated secret binding and never a URL credential.
- The legacy URL-secret initializer is denied in staging before credential access or comparison.
- Exact zero-authority and uninitialized predicates are enforced at commit time.
- Concurrent calls yield exactly one database commit; replay cannot mutate state.
- The final `setting` schema is canonical and seeded exactly once.
- D1 commit followed by KV refresh is recoverable without repeating the database mutation.
- Missing/wrong credentials, production invocation, replay, concurrency, partial KV failure, and evidence-redaction tests pass.
- The bootstrap is disabled and its dedicated staging secret removed after verified completion.
- The human user is created only through normal registration. The credentialed completion ceremony may create the sole canonical workspace/OWNER membership bound to that exact user; it never creates provider connections, credentials, grants, or OAuth sessions.

## Loop stop conditions

- Maximum five Maker–Checker iterations.
- No staging migration or Worker deployment before focused tests, regression tests, lint/static checks, diff review, and adversarial review pass.
- No OAuth session creation until the canonical authority tuple has been created through the normal UI and independently verified.

---

# NEXORA Brokered Delegated Authority and Zero-Touch Credential Convergence

## Mission state

- Repository check: PASS.
- Source boundary: isolated worktree only; dirty root remains untouched.
- Current phase: discovery and implementation-plan checkpoint.
- Iteration cap after approval: five Maker/Checker loops.
- External mutation status: none for this mission.

## Discovery findings

- The canonical OAuth token store already encrypts refresh and access tokens with AES-GCM and tuple/generation-bound AAD. Runtime consumers receive an opaque `credentialReferenceId`.
- The canonical Connection Runtime already enforces tenant/workspace scope, connection generation, lease ownership, and fencing for health and refresh.
- The current Provider Session is incomplete: production issuance is health-only and lacks a complete explicit expiry, capability, account/domain, and Mission-bound contract.
- Capability Invocation and Verified Action Boundary are separate from credential delivery, but canonical `search_email` reads synchronized D1 data and does not acquire a brokered Provider Session.
- Scheduled token refresh has leased work and a generation-fenced commit. Autonomous sync recovery, Watch/Subscription renewal, and automatic Mission continuation are not proven end to end.
- iOS stores the application auth token through Keychain, but has no AuthenticationServices, Passkey assertion, Password AutoFill Associated Domains, or trusted-device broker implementation.
- Worker Secrets protect platform secrets, but no least-privilege, expiring, environment-scoped Machine Service Identity contract is implemented.
- Proton Bridge, device-local decryption, and content-inaccessible providers need explicit unavailable/device-bound capability modeling and metadata-only evidence.
- Xcode Beta sees `Bill’s iPhone 17` as `available (paired)` and physical. No device acceptance result is claimed.

## Stop conditions

- Never read, log, persist, or replay any raw credential or authentication artifact.
- Fail closed on stale, expired, revoked, or cross-scope authority and credential-bearing Evidence.
- No staging deployment until the plan is approved and automated verification is green.
- No final PASS without staged lifecycle evidence, independent review, and physical-device acceptance.

## Current truthful status

`ZERO_TOUCH_BLOCKED — BROKERED_PROVIDER_SESSION_AND_TRUSTED_DEVICE_BOUNDARIES_INCOMPLETE`

---

# NEXORA Autonomous Staging Authority Tuple and Google OAuth Client Provenance

## Mission state

- Repository check: PASS.
- Current phase: read-only discovery and mandatory implementation-plan checkpoint.
- Root checkout: frozen; all proposed changes remain in the isolated worktree.
- External mutations for this mission: none.
- Staging Worker observed: `83c0b7a8-cc21-4324-91ff-b4640ca9bd39`.
- Staging D1 observed: `acf160ae-4efd-48d0-9d1b-7500f4cd0f41`.
- Remote D1 proof: User, Tenant, Workspace, Membership, Domain Authority, Account, Delegation, OAuth Session, Credential Reference, Provider Connection, and Connection counts are all zero; `setting=1`; bootstrap state is `READY_FOR_FIRST_AUTHORITY`; foreign-key check is empty; all reads reported `rows_written=0`.
- Secret-name-only inventory confirms the Google Client ID, Client Secret, and redirect bindings exist. No value was accessed.

## Canonical-model findings

- The retired secure bootstrap is disabled and its Secret is absent. Reusing it would violate this Mission.
- There is no currently callable canonical path that can create the first User/Tenant/Workspace tuple without that retired Secret.
- `workspace_account_delegations` supports lifecycle, consent, generation, audit, and cross-tenant checks, but its service allowlist cannot express `mail_read`.
- Domain Authority correctly requires server-derived ownership evidence; it cannot be inferred or self-asserted.
- Account creation exists, but must be fenced to the exact first User/Workspace/verified Domain and must not create credentials or Provider state.

## Current truthful status

`STAGING_AUTHORITY_BLOCKED — CANONICAL_MODEL_INCOMPLETE`

No OAuth session, Google consent, token exchange, Provider call, mailbox read, synchronization, watch, send, draft, refresh, Credential Reference, Provider Connection, or production mutation has occurred.

## Approved implementation checkpoint — 2026-07-24

- Maker implementation is complete in the isolated worktree; staging and production remain unchanged.
- Focused authority-tuple plus scheduled runtime: 36/36 pass. Final full RC: 24 files / 302 tests pass.
- Unit/syntax, Provider coupling, Connection coupling, OAuth artifact guard, dependency audit, migration repeatability, diff check, and staging dry-run bundle passed in the Checker loop.
- Cloudflare read-only inventory confirms the existing Google Client ID, Client Secret, and redirect URI bindings are `secret_text`; no binding value was read.
- Google Console read-only inspection currently blocks exact Web-client provenance: project `nexora-503322` is visible to one authenticated account but lists only an iOS client, while direct inspection of the expected Web client requires additional project access under the other authenticated account.
- No migration, Secret, deployment, OAuth session, provider call, or mailbox operation has been performed.
- Fifth independent Checker review: PASS with no remaining P0/P1/P2 in the implementation diff.
