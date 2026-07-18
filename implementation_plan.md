# NEXORA Communication OS + Goal-Driven OS Continuous Plan

## UCS HWM V3 long-interval checkpoint — 2026-07-17 00:15 UTC (NATIVE_RECLAIM_CONFIRMED_CONVERGENCE_IN_PROGRESS)

- Native reclaim confirmed (telemetry 2821→2934; V3 gen 132→148, proc 649→729, cursor →2026-07-13 03:39:55). Watermark immutable; backfill/membership READY; integrity 0; reads 0%; Worker 525681a1; flag true. contentMismatch 1336→1261, outbox_le_w 1650→1618, unexplained=outbox_le_w. Observed rates: ≤W outbox drain ~228h (~9.5d) is the dominant long-pole → native parity PASS ~1 week+ out absent a (forbidden) throughput change. Next: bounded read-only checkpoint after another ≥1h interval.

## UCS HWM V3 production activation — 2026-07-16 19:27 UTC

- HWM completion enabled in production for W2 (Worker `525681a1`, tag `v2026.07-ucs-hwm-v3-enabled`). Backfill READY-latched at hw=3807; V3 composite watermark `2026-07-16 19:23:13|conversation:623f0b8a…` frozen; V3 natively re-materializing ≤W. Verdict PRODUCTION_CONVERGENCE_IN_PROGRESS; reads 0%; FULL_PRODUCTION_PASS not declared.
- 19:43 UTC read-only observation: monotonic convergence (contentMismatch 1350→1336, outbox_le_w 1655→1650), integrity 0, watermark immutable, all native; parity passed=0. New >W mail (27) correctly excluded. Dominant long-pole = ≤W ingest-outbox drain (~1/min). Verdict PRODUCTION_CONVERGENCE_IN_PROGRESS.
- Next (read-only follow-up): observe V3 → READY latch, native parity → PASS with all integrity metrics 0, then evaluate a separate authorized projection-read cutover (gray-scale % + target build + real-iPhone). Rollback = flag `="false"`+redeploy or `wrangler rollback dbcf4c70`/`d05ffd3e`.

## Atomic primary-category contract — Maker loop 1/5 (2026-07-13)

1. Discovery completed: direct current-`Category` head writes are in sender-bulk and UCS backfill. The prior sender-bulk sequence committed head/snapshot before independent projection materialization, creating the production orphan-Facet failure window.
2. Generator completed: add `atomic-classification-mutation-service.js` with explicit `validateClassificationMutationContext`, `loadCurrentClassificationState`, `computeVirtualReplacementCategorySet`, `buildAtomicClassificationBatch`, `commitAtomicClassificationMutation`, `interpretAtomicCommit`, and `releaseCheckpointLeaseConditionally` boundaries. Sender-bulk v2 uses this shared path.
3. Generator completed: add migration 0053 for single current primary category per conversation/workspace/tenant. Historical Facet results are not rewritten.
4. Generator update: UCS backfill’s live `backfillFacets` binding now defers primary-category replacement to the same shared atomic contract; the prior compressed writer and unused direct-upsert path are removed. The source inventory confirms the shared service is the only current-`Category` writer.
5. Checker completed: Worker static check passes; focused sender-bulk/UCS tests pass 21/21; full Worker reliability passed 215/215 before the two added boundary tests. Isolated SQLite proves 0053 rejects duplicate current heads and permits transactional replacement. Full local replay is blocked at historical migration 0002 by a missing local-fixture `account` table, before 0053 runs. No migration or Worker deployment has occurred.
6. Generator update: sender-bulk preview now emits explicit historical-versus-current scope diagnostics, preventing the previous ambiguous retry-only count from being interpreted as disposition of the original failed operation.
7. Checker update: Workers-runtime D1 batch failure-injection test passes after repairing the fixture’s trigger setup. It queries committed state after a late injected failure and proves no partial current category, snapshot, Projection, All Mail or completed item leaked.
8. Read-only production safety inventory: 0053 is pending; duplicate current heads and Projection-category mismatches are both zero. The original immutable operation remains 26 failed items, while its current item scope now has zero current Promotions heads and complete current Projections. Reconciliation must account for this state transition without rewriting historical failure evidence.
9. Generator update: add append-only reconciliation ledger migration 0054 and a matrix service. No remote migration, reconciliation record, retry, or sender action has been executed. Focused atomic/D1/sender tests pass after the addition.
10. Read-only discrepancy conclusion: historical sender-bulk Promotions Facet results exist for all 26, but none are current heads; all 26 have current Projections. The historical diagnostic therefore used a historical-result predicate rather than the current-head predicate required for canonical state. No production mutation is justified by that historical observation.
11. Active generator increment: the authenticated reconciliation API currently records an immutable disposition but cannot yet bind that record to an executable corrective attempt. Add a Workspace-RBAC-protected, idempotent linked atomic retry that creates a distinct successor operation, appends per-item reconciliation lineage with that successor ID, and uses the shared fenced atomic classification boundary. The immutable failed original operation must never be edited.
12. Checker gate: prove retry preflight rejects mixed scope, missing source/projection, non-Promotions destination, and duplicate/idempotency divergence; execute static checks and the focused atomic/D1 suite before deployment. Production execution remains prohibited until the signed-in session reads a 26-row eligible matrix under the same production Worker version.
13. Production result: signed-in matrix preflight observed 26/26 eligible rows. First successor exposed duplicate immutable-evidence reuse; the transaction rolled back all category/projection changes and produced 0/26 completion. Second preflight exposed immutable-disposition hashing across deployment references; no classification transaction started. Both defects were repaired additively with source-version evidence reuse and migration `0055` append-only successor-attempt lineage.
14. Final backend checker evidence: migration 0055 applied remotely; Worker `8dacf839-80e2-4167-86d7-f7a11ed5f6d6` deployed; `npm run check` and `npm run test:rc` passed (221 tests). The final linked successor `sender-bulk-retry:1c064e9531f973a664c8dc2c4a973efcae7dc53135e23bccc060712616761e8c` completed 26/26. Independent read-only D1 checks verify 26 reconciliation records, 26 successor-attempt rows, 26 current Promotions heads, and 26 current Promotions projections.
15. Remaining human-visible gate: refresh and inspect production bundle `app.wangbei8554.pingguo736` on Bill's physical iPhone 17. Do not promote this backend reconciliation result to user-visible PASS without that real-device evidence.
16. Real-device checker result: the mirrored physical iPhone production app accepted the Inbox refresh interaction, but All Mail search for `Movoto` displayed `No Messages Visible` and visible count `0`. This fails the user-visible projection-read parity gate despite backend truth (26 current Promotions projections). Return to generator to trace iOS All Mail search/visibility filtering before any user-visible PASS.
17. Installation verification: the preceding real-device result was repeated only after USB installation and launch of signed production Build 347 (bundle `app.wangbei8554.pingguo736`, Team `4GGH43VE67`, SHA-256 `67751737ac181ce710659545257c201c1b19d1cfcb2e9d76449fca9535d65c03`). The same Movoto zero-visible result reproduced, therefore the real-device failure is attributable to the installed production IPA's query/visibility path.

## Active Plan — Unified Conversation System P0

Loop cap: five Maker–Checker iterations.

1. Discovery: map provider ingestion, evidence, classification, commitment, mission, and every required UI read path; identify direct provider-message dependencies and compatibility contracts.
2. Foundation: add provider-independent Conversation Aggregate, source bindings, messages, participants, facets, commitments, projections, checkpoints, failures, and outbox/materialization contracts without removing 0042/0043 or Gmail paths.
3. Convergence: dual-write/observe from existing sync and classification, backfill resumably, derive missions only from verified commitments, and expose authenticated Workspace-scoped projection APIs.
4. Read cutover: route All Mail, Categories, Action Required, Waiting For Me, Waiting For Others, Mission Control, Workspace communication views, and AI Briefs through Conversation Projection with an explicit compatibility fallback during rollout.
5. Checker/release: run structural, isolation, replay, fencing, fault-isolation, projection parity, Gmail regression, Worker reliability, migration dry-run, production canary, and physical-iPhone acceptance before declaring user-visible PASS.

Foundation execution result: steps 1 and the additive portion of step 2 are complete. Independent checker identified provider-derived identity, incomplete facet/commitment ontology, direct UI reads, missing mission provenance, and absent parity/rollback gates; the 0046 foundation and design address those contracts without production activation. Next: Gmail-safe post-commit observation/outbox, materializer fencing, resumable backfill, and parity evaluator. Read cutover remains forbidden.

## Latest completed device loop: Workspace-bound canonical Move (maker/checker cap: 3)

1. Discovery: real iPhone Move returned `workspace_bound_canonical_target_not_found`; remote aggregate confirmed legacy provider accounts had no Workspace mailbox binding.
2. Generator: add account-level Workspace binding that separates source-owner from authorized subject; bind owned or legitimately delegated accounts at Workspace resolution and the action boundary.
3. Checker: remote migrations `0044`/`0045`, Worker `2da3173a-f11c-423f-bb6f-46344a9c5af9`, syntax and 194 reliability tests, then real iPhone Move → Undo → Search PASS with committed canonical receipt.

## Active P0: All Mail Classification and Mail Action Integrity (maker/checker cap: 5)

1. Discovery: trace canonical IDs and every All Mail/List/Detail/Search action from hit target through API, database, cache/index and sync ownership; inspect production misclassification/state drift safely.
2. Generator: add canonical mail state, evidence-gated financial/marketing and Priority policy, Manual Override ledger, versioned/idempotent mutation and reconciliation contracts.
3. Generator: wire iOS actions and authoritative response reconciliation across All Mail, Category, VIP, Priority, Junk, Starred, Search, Conversation and Detail with visible rollback/errors.
4. Checker: run red/blue classification, cross-scope, rapid mutation, stale sync/response, batch, regression and adversarial interaction tests; deploy migration/Worker and perform audited production repair.
5. Device closure: build production bundle with Xcode Beta, install on Bill's iPhone 17, execute the 30-step production acceptance, preserve xcresult/screenshots/log evidence, and report PASS only if the entire user-visible loop succeeds.

## Active P0: Classification, Commitment and Thread-to-Mission Intelligence (maker/checker cap: 5)

1. Discovery: map existing classification, thread, message, Evidence Ledger, Runtime and production authority contracts; extract only provider-neutral product principles from official competitor documentation.
2. Generator: add append-preserving layered classification, Conversation state/versioning, Commitment lifecycle, evaluation set/metrics, observability and Thread-to-Mission candidate/guard contracts behind a scoped rollout.
3. Generator: integrate the sole `nexora_autonomy_jobs` transport and create only internal side-effect-free Durable Missions after security, identity, evidence, duplicate and authority-context guards.
4. Checker: run focused evaluation, safety, deduplication, replay, expiry, lease/fencing and complete Worker reliability suites; adversarially review tenant isolation and no-side-effect guarantees.
5. Release boundary: apply additive migration, deploy Worker/API, run safe representative production and controlled-fixture chains, verify consistency and preserve zero credential/OAuth/reconnect/outbound/provider-write effects.

### Completion loop

1. Add backward-compatible 0043 lifecycle/deadline/checkpoint/scope contracts and guarded service transitions.
2. Implement deterministic multi-message evolution, overdue/idempotency, replay relations and conversation expected-version checks.
3. Expand evaluation-v2 with per-layer metrics and immutable release gates; add privacy-safe drift observations.
4. Execute adversarial database, fencing, takeover, stale-write, cross-scope and terminal-race tests plus full reliability.
5. Deploy, run controlled lifecycle/recovery proofs and safe production replay, then reconcile all ledgers and zero-side-effect counters.

Production closure evidence: steps 1-5 completed for P0. Migration `0042`, Worker `9849ae8a-8684-463b-ad7c-f49ea0d57406`, flag scope, 170/170 tests, four healthy production messages, one idempotent replay, one safe awaiting-review Mission, two information-only thread updates, automated-origin remediation, and zero Action/Tool/Outbound evidence are recorded. Enterprise Authority remains a separate event-driven external dependency.

## Active P0: Multi-Gmail reconnect recovery (maker/checker cap: 5)

1. Discovery: trace reconnect launch state, callback identity validation, credential attachment, immediate sync, scheduler eligibility, and client refresh without reading credentials or message content.
2. Generator: bind reconnect state to target account, hashed expected identity, tenant/user, and authorization generation; reject mismatches before any persistent provider-token mutation.
3. Generator: atomically gate account-generation advance and credential replacement so stale callbacks cannot delete or replace newer account credentials; dispatch exactly one bounded account-scoped recovery sync after success.
4. Checker: run source syntax, reconnect containment tests, full Worker reliability suite, remote migration/schema checks, and non-destructive healthy-account regressions.
5. Device boundary: build/install the production bundle and validate in-app reconnect only through the native Google authorization boundary; do not collect any secret or claim real-provider completion without user-visible evidence.

## Active P0: Durable Mission Runtime kernel (maker/checker cap: 5)

1. Discovery: reuse outbound idempotency, autonomy-job lease semantics, Workspace RBAC, provider authority, and audit foundations; keep Gmail contracts unchanged.
2. Generator: add tenant/workspace-scoped Mission business records, guarded transitions, leases, idempotency keys, action-specific approvals, capability decisions, sanitized tool calls, evidence, and verification records.
3. Generator: expose only authenticated, workspace-scoped internal APIs and a bounded private-draft pilot; external send remains paused until an exact approval is consumed.
4. Checker: execute migration, transition, retry/resume, concurrency, callback replay, approval, tenant-isolation, privacy and existing Gmail regression suites.
5. Release boundary: deploy only after the migration baseline, Worker target, rollback path and Gmail regression evidence are unambiguous. A real external send is excluded without explicit per-step approval.

## Active P0: Evidence Ledger and Verified Action Boundary (maker/checker cap: 5)

1. Discovery: trace deployed `0037`/`0038` contracts, scheduler fencing, approval binding, checkpoint recovery, and the existing read-only Gmail probe; preserve `nexora_autonomy_jobs` and `outbound_messages` as the sole transport/domain state machines.
2. Generator: add an additive ledger schema for claims, immutable evidence envelopes/relations, policy versions, verification inputs/results, and guarded outcomes; use safe hashes and controlled references only.
3. Generator: make deterministic verification reject stale, revoked, superseded, integrity-failed, duplicate-inflated, cross-scope, incomplete, or conflicted evidence; require verified claims for action/outcome finalization.
4. Checker: exercise migration, append-only behavior, isolation, integrity, freshness, relation, policy replay, action approval boundary, lease fencing, recovery, duplicate callback and finalize tests plus full Worker reliability.
5. Release boundary: deploy the additive migration and Worker only after remote schema, bounded no-send production read-only chain, negative proof, outbound waiting-for-approval proof, and rollback isolation evidence are captured.

## Active P0: Provider Capability and Authorization Contract (maker/checker cap: 5)

1. Discovery: map safe Gmail account, freshness, authorization-generation, credential-reference, Workspace membership and blocked-state fields; research only public multi-account/reconnect/degradation design principles.
2. Generator: add additive provider identity, authority, capability, action-requirement and decision contracts; keep provider-specific data namespaced in the Gmail adapter and bind all contracts to tenant/workspace/generation.
3. Generator: gate Runtime provider dispatch through a fresh Decision that validates identity, authority, capability, policy, exact approval, parameter digest and fencing; preserve existing outbound state machine.
4. Checker: test all decision results, stale/invalidation/isolation/fencing/replay paths and regress the Runtime/Evidence contracts.
5. Release boundary: deploy only after safe production probes of healthy, needs-reconnect, blocked and outbound-approval paths record evidence-backed decisions with no credential read, send, or reconnect.

## Active P0: Autonomous Action Control Plane (maker/checker cap: 5)

1. Discovery: trace the existing read-only Runtime Action to its Tool Call and keep the provider adapter boundary free of policy, approval and outcome decisions.
2. Generator: persist Action Requirements and Decision Records before dispatch; bind decision reuse to scope, parameter digest, authority generation, capability freshness, policy, approval and fencing.
3. Generator: refuse non-executable decisions before Tool Call, recording safe reason codes and durable waiting/blocked states without changing Gmail state.
4. Checker: exercise healthy, reconnect, unsupported/policy-denied, outbound, stale, takeover and duplicate-dispatch paths; regress Runtime/Evidence/Approval contracts.
5. Release boundary: deploy only after each safe production chain records Decision → Evidence → Verification/blocked terminal state and proves zero external communication.

## Active P0: Enterprise Identity, Membership and Delegation Control Plane (maker/checker cap: 5)

1. Discovery: preserve legacy owner membership, account ownership and governance records; reject domain-based or inferred relationships.
2. Generator: add invitation, membership authority, delegation, owner consent, approval, scope, generation and append-only audit contracts.
3. Generator: expose authenticated Admin Workflow operations and integrate Runtime authority resolution before Provider Decision.
4. Checker: test isolation, SOD, scope restrictions, token replay, idempotency, activation races, expiry/revocation and stale-generation rejection.
5. Release boundary: deploy the complete denial-safe control plane; run production denial smoke only. Leave positive authority `EXTERNALLY_PENDING` unless a real request and approvers exist.

Closure evidence: steps 1-5 completed for the denial-safe platform path. Migration `0041` and Worker `54773f95-e312-47ed-af54-c2be732d955e` are live; 164/164 reliability tests pass; production job `12` persisted a cross-tenant denied Decision and durable recovery action with zero Tool Calls/outbound communication. The positive membership/delegation chain remains intentionally `EXTERNALLY_PENDING` because no legitimate business request or approval record exists.

### Durable Mission Runtime execution evidence

- Applied remote migrations `0037_durable_mission_runtime_kernel.sql` and `0038_durable_mission_runtime_execution_hardening.sql`.
- Deployed the bounded Runtime scheduler alongside, not instead of, existing NEXORA autonomy scheduling. Runtime Job type is explicitly excluded from the generic scheduler to prevent cross-handler consumption.
- Ran one `MISSION_RUNTIME_READONLY_PROBE` in workspace 1 for an eligible Gmail account. The first run safely failed on a binding defect, the second safely stopped at a completion guard because of date-format comparison, then a forced expired lease was reclaimed by fencing token 2 and completed from its persisted checkpoint. The final Job is `SUCCEEDED`, Evidence/Verification/Outcome are `supported`/`verified`/`verified`, and Mission is `completed`.
- No provider credential, message content, OAuth mutation, authorization scope change, outbound message link, or external communication was used. Do not treat this as iPhone evidence; it is a backend-only production probe.

## Active P0 continuation: Gmail provider 404 provenance and truthful recovery boundary

1. Discovery: trace only the account-scoped provider operation and authorization generation; do not inspect OAuth payloads, addresses, token material, message content, or raw hashes.
2. Generator: persist safe Gmail provenance and distinguish identity mismatch from a provider profile 404; preserve a verified authorization after a provider 404 and stop futile scheduler retries.
3. Checker: execute syntax, recoverable-state tests, full Worker reliability suite, deploy, then trigger one controlled probe per affected account and query only safe state/provenance fields.
4. Device boundary: create immutable Build 328, install the production bundle on Bill's iPhone 17, and require a refreshed Accounts visual observation before any UI verdict.
5. Stop condition: only mark synchronization PASS after a verified Gmail checkpoint and user-visible mailbox refresh. A matching-identity Gmail profile 404 is a genuine provider-side blocker, not a reconnect or completed-sync result.

1. Discovery: audit user-visible branding and every high-frequency mail action across Inbox, All Mail, detail, search, settings, accounts, AI, calendar and workspace.
2. Generator: repair persistent provider-neutral Move/folder semantics, then unify archive/delete/restore/junk/category workflows and truthful feedback.
3. Generator: complete Apple-grade selection, bulk operations, quick actions, undo, smart Move destinations, intelligent filters and the four-action detail hierarchy.
4. Evaluator: run Worker tests, migration validation, Swift simulator/device builds and action-specific checks; reject any local-only or no-feedback behavior.
5. Device closure: sign, install and launch build 302 on the connected iPhone; exercise Move, undo, multiselect, bulk and navigation workflows and collect screenshots/log evidence.
6. Goal OS: make Goals the default Home, reuse the governed Mission/ExecutionPlan foundation, add Today, Execute, Spaces, People, Briefing and evidence-backed health without fake percentages.
7. Communication Intelligence: COMPLETE for the first real-device increment — Intent, Action, Context, Relationship, Attention, Trust and Lifecycle are separated while preserving the original communication record and provider-independent access.
8. Scalable operating surfaces: COMPLETE for Goal Center, Goal Detail, Spaces, People, Provider Matrix, Health, over-five NEXORA center details, honest Inbox search, and Execute template action reality. Completion Evidence still needs verified growing-data expansion and evidence-opening acceptance before that full Execute surface is PASS. Continue auditing only lists that silently truncate or overwhelm the normal path.
9. Provider adapter hardening: in progress. The onboarding graph represents independent mailbox, infrastructure, DNS, calendar, and identity adapters with declared versus operational capability truth. AUTHORIZED now requires both scopes and verified provider capability probes. Do not claim a live provider integration until callback/probe evidence exists.
10. Delivery: increment the validated release, preserve rollback artifacts and produce one final Mission report with only evidence-backed PASS claims.
## Active Plan — Hybrid Apple On-Device Mail Intelligence and All Mail Integrity P0

Loop cap: 5 Maker/Checker iterations.

1. **Discovery** — verify Xcode Beta Foundation Models SDK contracts, device/OS availability, existing Apple-local adapters, canonical mail state/actions, toolbar hit testing, production authority, and safe sample boundaries.
2. **Maker: hybrid evidence plane** — implement provider-neutral structured local-evidence contract, Apple capability adapter, privacy/fallback policy, server validation/finalization, priority hard gates, durable override fencing, audit/evidence, and reconciliation controls.
3. **Maker: client/action convergence** — route visible mail operations through canonical targets and versioned server mutation; reconcile All Mail/search/category/detail/conversation caches; fix toolbar accessibility/hit targets and explicit unavailable states.
4. **Checker** — run adversarial review, SDK/build checks, red-team/parity/privacy/tenant/concurrency/reliability tests, migration dry-run, production reconciliation dry-run, and resolve every P0/P1 finding.
5. **Production and real device** — apply reversible migrations, deploy and observe Worker version, build/install production bundle with Xcode Beta, then exercise Apple-enabled and unavailable fallback paths plus all required mail actions on Bill's iPhone 17; preserve xcresult/log/report evidence.
## Active Plan — Complete AI-Native Classification, Commitment and Thread-to-Mission P0

Loop cap: 5 Maker/Checker iterations.

1. Audit deployed 0042 contracts and local 0043/service/tests against lifecycle, deadline, fencing, replay, scope and evaluation-v2 criteria.
2. Complete backward-compatible 0043+ services/APIs for guarded lifecycle/deadline/thread evolution and classification checkpoint/takeover.
3. Add structural isolation, concurrency, stale-worker, late-message, replay and multi-message evolution integration tests plus evaluation-v2 per-layer metrics.
4. Run independent adversarial Checker, migration execution, complete reliability and safe production smoke; resolve all P0/P1 findings.
5. Apply only reviewed mission migrations, deploy/observe Worker version and verify production ledgers, feature flags, zero provider/outbound side effects and rollback controls.
## Active Plan — Complete Hybrid Mail Intelligence and Action Integrity P0

Loop cap: 5 Maker/Checker iterations.

1. Isolate unrelated 0043 changes; audit 0044/0045, canonical read/write paths, iPhone old actions and toolbar interaction.
2. Make mutation state/override/receipt/audit atomic and recoverable; add idempotency payload binding, expected-version CAS, canonical target and restore-auto policy recomputation.
3. Cut all mail surfaces and iPhone actions to canonical contracts with stale-response rejection, rollback and query/index reconciliation.
4. Validate Apple evidence/fallback privacy and parity; run integration/concurrency/reliability plus independent adversarial review until accepted.
5. Apply only 0044/0045, deploy Worker/build, validate safe production state operations and both Apple/fallback paths on Bill's physical iPhone 17 Pro Max.
# Apple Evidence Production Chain — execution result (2026-07-12)

The source and backend production chain is complete and deployed. Evidence remains candidate-only on device; the server alone emits the bounded policy decision. Free-text evidence is rejected, legacy unbound security signals fail closed, decisions are content-digest bound, and expiry renewal creates a new append-only issuance. Final physical-device acceptance remains separated as `MANUAL_BOUNDARY` because the locally available personal signing team cannot create a production-bundle provisioning profile with the App ID's iCloud capability.
# Classification Fencing / Conversation CAS / Commitment Evidence Plan (2026-07-12)

Iteration cap: five Maker–Checker rounds.

1. Extend 0043 additively with row-level job/generation/input binding, database triggers, CAS authorization records, evidence-bound Verification, atomic Deadline replacement contracts, legacy quarantine and authoritative evaluation audit.
2. Refactor classification and lifecycle services so every durable write occurs in an atomic D1 batch whose insert/update is accepted only while the exact job generation remains current.
3. Add deterministic integration tests for stale takeover, Conversation CAS, late/out-of-order message, cross-binding Verification, terminal/Deadline races, DST and counter unavailability.
4. Run static, focused, integration and full reliability validation; iterate against an independent adversarial Checker until ACCEPTED.
5. Only after acceptance: restore migration 0043, dry-run, apply remotely, deploy with explicit rollout flag, verify production facts and zero external/provider effects.

## Classification P0 execution update — 2026-07-12

1. Completed: additive 0043 schema guards, authoritative D1 release evaluator, independent structural Checker, JS check and 23-file/194-test reliability suite.
2. Completed: remote 0043 applied and remote `sqlite_master` query confirms every required trigger family; Worker deployed as `1751abe4-bb99-4077-9b8d-4eb3af25014e`.
3. Completed: production build 329 signed, exported, installed and launched on Bill's iPhone 17 with immutable IPA hash evidence.
4. Next: execute and capture real-device interaction acceptance for classification/All Mail behavior. Do not substitute install/launch for workflow proof.

## Move / Undo / Search closure result — 2026-07-12

Maker–Checker loop completed in one corrective iteration:

1. Discovery confirmed the original version fix compiled, then adversarial review found that the test could falsely pass when Undo failed because the affordance was cleared before the canonical mutation completed.
2. Maker changed Move to return success, retained Undo on failure, disabled duplicate Undo while in progress, and made delegated folder filters consistently Workspace-binding aware.
3. Checker evidence passed: Xcode Beta Release compile, Worker syntax check, and 194/194 reliability tests.
4. Production release completed: Worker `cb6c931d-7c1d-4e5b-8b6f-51f3f5faa8c0`; production IPA build 330 SHA-256 `fa225b040561174546913c9032df0720685201cf947578f8f36f940c77d229ef`; USB install sequence `5612`.
5. Physical-device stop condition met: `NEXORA-v3.03-build330-move-undo-search-canonical.xcresult` reports 1 passed, 0 failed on Bill's iPhone 17. Move → Undo → Search is PASS for `app.wangbei8554.pingguo736`; no broader user-visible scope is inferred.

## Enterprise Attention / manual move loop — 2026-07-12

1. Discovery found that canonical folder state was already the appropriate shared source of truth, but manual `move_folder` did not create a durable override/Junk disposition; detail UI also claimed success before receipt.
2. Maker made the server commit folder and Junk disposition in one CAS-protected transaction and converted all user-visible Junk paths to the shared `moveToJunk` operation.
3. Checker completed Xcode Beta compilation and 194 worker reliability tests. Worker deployment is `26e7e836-b141-49da-b1eb-c04275508b8c`.
4. Next checker step is a newly numbered signed production IPA and real iPhone test for swipe Junk, source removal, Junk-only visibility, refresh persistence, Undo and stale-version recovery.

## Unified Conversation System activation loop — 2026-07-12

Iteration cap: five Maker–Checker rounds.

1. Completed: UCS immutable schema, current facet/commitment heads, checkpoint fencing, retry ledger, projection API pagination, six-surface client authority handshake, schema application, and shadow Worker deployment.
2. Completed: replace global-count pseudo-parity with per-surface expected/actual conversation-ID sets plus aggregate-version, materializer-version, message-count, coverage, and unresolved-failure checks.
3. Active: allow the production scheduler to complete the resumable shadow backfill and resolve retryable fence failures without enabling projection reads.
4. Required before cutover: independent acceptance of aggregate folding, stale-facet invalidation, commitment lifecycle/evidence verification, Mission Runtime provenance creation, ingestion-path dual write, and projection-native actionable details.
5. Stop gate: only enable `projection_read_enabled`, build/sign/install the next production IPA, and run real-iPhone six-surface acceptance after all six parity records pass for one epoch with zero unresolved failures.

## UCS current execution state — 2026-07-13

1. Completed: bounded normal scheduler throughput, strict canonical receipt validation, and checkpoint freshness accounting; no direct outbox mutation or queue bypass was used.
2. Completed: final Worker `8d7d9bc4-1dd4-4841-a471-8b8c419c4ffe`; checks passed and reliability suite is 203/203.
3. Completed: Workspace 1 fresh gate at watermark 3104—strict receipts, outbox, failures, six-surface parity, commitment evidence, and mission provenance all clean. Guarded database transition reached 100%; Workspace 2 remains shadow-only.
4. Active blocker: physical iPhone XCTest requires an unlocked device. Resume only after the existing USB-paired device is unlocked; rerun `testNexoraUCSAuthoritativeProjectionRealIPhone` and inspect `artifacts/nexora-v3/NEXORA-v3.03-build342-ucs-authoritative.xcresult` before any user-visible PASS.

## Compliant acceptance signing checkpoint — 2026-07-13

1. The unlocked-device result is preserved as immutable harness-path failure evidence; All Mail must be selected explicitly.
2. The harness now opens the mailbox selector and selects merged All Mail before testing projection rows.
3. The auto-provisioned runner is quarantined and excluded from acceptance evidence.
4. BLOCKED: the mandated `/Users/billtin/Documents/cloudmail/profile` signing-assets directory is absent. Resume only after those authorized assets are restored; never fall back to automatic provisioning.

## Deferred device / backend continuation checkpoint — 2026-07-13

1. Device acceptance is deferred, not waived: `DEFERRED_BLOCKED_BY_APPLE_TEAM_MEMBERSHIP`; retain the corrected explicit merged-All-Mail harness and all historic xcresults.
2. Do not activate Workspace 2 until both current checkpoints and normal ingest queues converge at a fresh shared watermark.
3. Current backend blocker: Workspace 1 live events remained in expired `processing` leases and Workspace 2 had pending events, with no manual state mutation permitted. Diagnose normal scheduler invocation/reclaim before guarded Workspace 2 1% rollout.

## XCTest runner authorization requirements — 2026-07-13

1. Production profile `0855a35a-f46c-4ddf-95ca-a841a9c27bc1` is valid only for `app.wangbei8554.pingguo736` under Team `4GGH43VE67` and cannot sign the runner.
2. Current acceptance identifiers and automatic signing configuration are owned by another team and are rejected.
3. Minimum Apple-side authorization: a Team `4GGH43VE67` Apple Development certificate and matching development provisioning profiles including device `00008150-000629623EC0401C`, a Team-owned acceptance host ID, test-bundle ID, and XCTest runner authorization. Place them in `/Users/billtin/Documents/cloudmail/profile`; resume with manual signing only.

## UCS repair / production-app validation update — 2026-07-13

1. Maker: identified Cloudflare Free-plan `exceededCpu` before UCS execution; rejected the unavailable paid-only CPU-limit configuration without changing production.
2. Maker: deployed resumable persisted-facet completion and bounded UCS-first scheduling. Worker `da4dfe28-42f6-4a44-978b-95314be57852` drains two live items per workspace per minute while retaining lease fencing and strict receipt validation.
3. Checker: source syntax, 7 focused UCS tests, and 203 reliability tests pass. Worker Tail recorded successful scheduled UCS runs (two live plus two backfill rows per workspace) with no exceptions.
4. Production gate: both workspaces reached ready watermark `3120`, outbox/failure backlog is zero, and same-watermark parity is 6/6 pass with zero differences. Keep Workspace 1 at 100% and Workspace 2 at 0% until the independent rollout contract is executed.
5. Device gate: authorized Build 342 production app was launched over USB and captured. App-native direct navigation control is unavailable without the separately signed XCTest runner; only Email → All Mail is awaiting the minimum manual touch, after which automated screenshot/API/projection correlation resumes. Do not claim XCTest PASS.

## Workspace-targeted production-app acceptance correction — 2026-07-13

1. Discovery: the captured Build 342 All Mail page was a real UI state but had 50 visible items. API/runtime inspection established that server-default resolution chose the separate Workspace 2, which is intentionally 0% shadow-only; it could not evidence Workspace 1 authoritative reads.
2. Maker: add a membership-constrained, persisted active-workspace selector in the production app. Projection loads and local canonical actions resolve the selected workspace from the current membership list; invalid persisted IDs fall back to the server default. This preserves tenant isolation and does not change either workspace rollout.
3. Checker: Xcode Beta unsigned Release build passed. Build 343 manual production archive and export passed with App ID `app.wangbei8554.pingguo736`, Team `4GGH43VE67`, and the audited app-only profile. Immutable IPA SHA-256: `06205cc20f8cc3a2fe5a9c12f1e0f1fb7c3a0d0c6b634182ce93fc9027f95e79`.
4. Device: Build 343 is installed through USB and launch evidence is preserved at `artifacts/nexora-v3/production-app-real-iphone-20260713/build343-launch.png`.
5. Next gate: select Workspace 1 (`NEXORA Runtime Validation`) from the new mailbox-drawer Workspace section, select All Mail, capture USB evidence, and correlate the UI count/list against one freshly settled Workspace 1 projection page. Do not advance Workspace 2 or claim XCTest acceptance.

## Move All From Sender authority repair — 2026-07-13

1. Discovery: the current implementation is a client-local raw-message loop and hard-coded folder menu. It is not an authoritative Facet Classification or Conversation Projection operation.
2. Maker plan: add additive UCS bulk-action storage and a Worker service/API which resolves Workspace membership, exact normalized sender scope, eligible authorized conversations, destination capability, reversible preview, idempotency, fencing, evidence/audit/mission/action/outcome records, Facet mutation/projection materialization, and truthful provider synchronization.
3. Maker plan: replace every iOS sender-bulk menu with the returned contract and a sheet that supplies preview/confirmation/progress/undo and stable bilingual accessibility identifiers.
4. Checker plan: adversarially test sender identity and tenant boundaries, concurrency/idempotency, partial provider failures, Facet/Projection parity, Commitment preservation, and duplicate rendering. Only then deploy and build the production app.
5. Device gate: validate a low-risk representative sender on the real production app. XCTest remains deferred unless separately signed Team 4GGH43VE67 runner assets become available.

Evaluator finding: reject the existing implementation. Beyond hard-coded UI and raw-message scope, its canonical mutations never enqueue UCS rematerialization; it cannot truthfully prove classification projections. The server-owned operation must explicitly preserve Commitment heads and enforce provider capability degradation.

## Sender bulk implementation checkpoint — 2026-07-13

1. Applied additive migration `0052_ucs_sender_bulk_classification.sql` and deployed Worker `45cd86a9-9c7e-4b5f-8abb-be527c3ab4a3`.
2. The API returns authoritative grouped destination contracts. Classification is enabled; mailbox and workflow entries are deliberately disabled with their provider/Commitment authority reasons until their separate contracts exist. Promotions, Primary, Social, Updates, Forums, and observed valid custom Facet categories are available.
3. The only enabled execution path is exact-normalized, one-time Facet classification. It deduplicates at `conversation_id`, excludes already-targeted conversations on reapply, appends verified evidence/facets/snapshots, rematerializes projections, and writes operation/item/evidence/audit/outcome records without changing commitments or claiming a provider label effect.
4. Verification: Worker check; focused sender/UCS tests 9/9; full reliability suite 205/205; Xcode Beta Release compile. Build 344 is signed/installed with IPA SHA-256 `650b668a9914bb0e93d9fc4a00080fa1b8466a81768f199ecbebae61b17bd5d9`.
5. Production preflight is fresh at watermark 3153: both checkpoints ready, zero unresolved outbox and pipeline failures. Next, capture the real-device open menu and then choose Promotions only for a representative low-risk sender. Keep Workspace 2 shadow-only and XCTest deferred.

## Sender bulk integrity-repair continuation — 2026-07-13

1. **Discovery result:** six-surface count/ID parity at watermark `3153` is healthy, but a strict receipt graph audit rejects historical receipts whose stored projection is no longer current or whose observation row is absent: W1 `117` and W2 `131`. Canonical state coverage is also incomplete (W1 `1576/1576`; W2 `1574/1636` fallback-only messages).
2. **Maker next:** add a fenced, resumable receipt/projection reconciliation that only regenerates a receipt after it binds a verified evidence record, active observation, current projection, and exact source version. Add canonical-state initialization through the normal versioned authority path; never direct-edit queues, receipts, or cutover flags.
3. **Checker next:** prove idempotency under concurrent workers, tenant/account scope, no commitment changes, zero strict-invalid receipts, complete canonical coverage, and a fresh single-audit-run six-surface result at the resulting watermark.
4. **Device next:** only after those gates pass, use the installed production Build 344 (or immutable successor) to capture preview, execute a low-risk sender classification, verify durable projection update and preserved commitments, and collect final real-iPhone evidence. XCTest runner status remains separately deferred.

### Integrity-audit correction — 2026-07-13

1. The proposed receipt/projection reconciliation is not required: its trigger was an invalid audit assumption that historical receipt projection IDs must remain current. The deployed receipt predicate requires verified evidence plus a current projection for the same conversation, and production reports zero invalid receipts in both workspaces.
2. Do not initialize canonical folder rows merely to satisfy this rejected audit; unmutated historical messages legitimately use the compatibility folder fallback. Preserve the established versioned mutation path for any future provider-folder action.
3. The actual remaining gate is compliant UI automation. `devicectl` supports launch, URL open, screenshot, and limited system simulation but not touch injection. A Team `4GGH43VE67` Development identity and matching acceptance profiles remain required before XCTest may drive the confirmation flow.

## Build 347 stable sender-bulk surface — 2026-07-13

1. Maker: moved the sender-wide production mutation flow out of nested SwiftUI menus into `SenderBulkClassificationSheet`. All supported classification choices now lead to one durable preview/review/apply surface; unsupported mailbox/workflow choices stay explicitly disabled with their contract reason.
2. Checker: Xcode Beta unsigned Release compile and `ucs_authoritative_cutover_test.py` passed. The standalone Node sender-bulk script cannot resolve this Worker project's extensionless ESM imports under raw Node; this is recorded as a test-harness limitation, not treated as a passing sender-bulk test.
3. Deployment: client-only Build 347 was manually signed with the authorized production distribution identity/profile, exported as `artifacts/nexora-v3/export-build347-sender-bulk-stable-sheet/NEXORA.ipa` (SHA-256 `67751737ac181ce710659545257c201c1b19d1cfcb2e9d76449fca9535d65c03`), and installed over USB on Bill's iPhone 17.
4. Device evidence: the production app launched and Mirroring reached Inbox; USB screenshot is `artifacts/nexora-v3/production-app-real-iphone-20260713/build347-mail-search-boundary.png`. Production `conversation_sender_bulk_operations` remains empty, which proves no unintended sender-wide mutation occurred.
5. Next bounded loop: reliably select the exact The Children’s Place conversation, open `Move All From Sender`, select Promotions in the independent sheet, inspect the preview, press Apply through Mirroring, then correlate the single operation and perform refresh/restart evidence. Do not process Schuurman Schoenen, YOOX, or EyeBuyDirect until that canary passes; keep Workspace 2 shadow-only and XCTest deferred.

## Elements Outfitters atomic retry and real-device closure — 2026-07-13

1. Discovery: the real-device sender-bulk alert `Moved 0 conversations; 1 need review` correlated to a partial production operation. The failed item was blocked by `UNIQUE constraint failed: conversation_sender_bulk_evidence.id` after the atomic contract correctly reused already-verified source evidence.
2. Maker: keep reusable source evidence immutable, but derive a separate `sender-bulk-evidence:<digest(operation,item,source-evidence)>` primary key for the append-only operation ledger. The ledger's before-state records the source evidence reference; no provider label, mailbox, Commitment, or VIP overlay is changed.
3. Checker: `npm run check` and full `npm run test:rc` passed (221 tests); deployed Worker `88247cd4-9313-4ea4-8bf8-dcce8c6f7329`. Production operation `sender-bulk:66905140d5587f70b483f1fac1209d54f5de8f9eb36c20032ab571879fc53024` is completed, 1/1, zero failures.
4. Device: on the production Build 348 app installed by USB, Mirroring opened Elements Outfitters → Move All From Sender → Promotions → review (`1` conversation, `12` accounts) → Apply. The app visibly displayed `Moved 1 conversations to Promotions.`
5. Classification/VIP truth: the current facet audit shows all three Elements conversations at `Category=promotions` and no `Overlay=vip`; `VIP & Priority` is a combined Inbox grouping rather than proof of a VIP facet. Direct VIP-filter visual regression and remaining menu loops are still required before all-menu PASS.
6. Real-device VIP regression is now complete: production Inbox → VIP filter visibly rendered `No Messages Visible`, `Visible Count 0`, and Elements was absent. This agrees with the canonical Facet query; it does not treat a Priority grouping as a VIP mutation.

## Requested Build 346 retry — 2026-07-13

1. Restored Build 346 to the production app through USB at the user's request and launched it on Bill's iPhone 17.
2. Mirroring reached Mail, but keyboard injection currently replaces/reorders successive search characters. Exact sender selection cannot be proven from that state.
3. Stop condition remains exact identity selection before any bulk mutation; do not classify a different sender merely to complete the UI flow. XCTest remains deferred.

## Build 346 Movoto canary result — 2026-07-13

1. With explicit user authorization, a real-iPhone Movoto message reached the Build 346 sender-bulk destination menu and selected Promotions through iPhone Mirroring.
2. Checker: queried production immediately and after eight seconds. `conversation_sender_bulk_operations` remained empty. The UI selection caused no preview or execute request and created no durable UCS state.
3. This is a reproduced dead-action defect in Build 346. The stable independent-sheet implementation in Build 347 remains the required correction; no bulk-classification acceptance can be claimed for Build 346.

## Build 347 real-device operation result — 2026-07-13

1. Build 347 independent sheet repaired the first missing boundary: the real-iPhone Apply action created one durable operation and linked Mission/Action records.
2. Checker: operation `sender-bulk:74f0ba493dcf5b494541dd44dd84565e23b898df940de556b7f1e81769ab1c52` targeted workspace `2`, Promotions, 26 conversations/12 accounts, then ended partial with 0/26 completed.
3. All item failures are `D1_ERROR: conversation_projection_scope_or_fence_rejected: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_TRIGGER)`. Preserve the failed operation as evidence; next maker loop must reconcile materializer checkpoint/fence scope before any retry or further sender.

## Build 352 projection-version and fence repair — 2026-07-13

1. Maker: sender-bulk takes the shared projection fence before creating durable operation state, waits briefly for an active writer, and lets iOS retry the explicit busy condition automatically. This preserves the single-writer fence and avoids raw internal error alerts.
2. Maker: source-row rendering consumes the current workspace's Projection category and selects the highest projection version when historical rows reference the same source message. A Projection category is authoritative over AI priority for inbox grouping.
3. Checker: Worker check, reliability suite 221/221, focused sender suite 15/15, and Xcode Beta unsigned Release compile passed. Worker `e7a030a5-8e8f-4bc0-9ccf-756ebc77995a` is deployed.
4. Device: Build 352 signed IPA SHA-256 `d81ebf0cc1d8a9276d81cc84c108e6e11babaaf5fb98c5f40f760e93bb7b0901` is installed/started on the production bundle on Bill's iPhone 17. VIP filter returned zero messages.
5. Remaining device gate: execute Promotions for Elements in the actively rendered workspace, then refresh/restart and prove it is absent from VIP & Priority while visible under Promotions. Do not merge classifications across workspaces; that would violate tenant isolation.

## Workspace 1 row interaction loop — 2026-07-14

1. Discovery: the visible Workspace 1 shadow rows were legacy EmailRow cells. Their outer detail Button embedded the inline star Button, producing an unsupported nested UIKit control hierarchy and swallowing normal row taps.
2. Maker: split star and detail navigation into sibling controls; preserve swipe actions, context actions, navigation path, and edge-drawer behavior.
3. Checker: unsigned Xcode Beta Release build passed. Next: archive Build 353, install via USB, prove repeated row open/back interaction, then execute the approved Workspace 1 Promotions flow and verify refresh/restart parity.

## Build 353 physical-device checkpoint — 2026-07-14

1. CP1/CP2 passed: signed IPA SHA-256 `f7da495b486762fe495251f346b16a040d6cb785da721ce0aab240c6e8db5f1b` exported, installed, and launched on Bill's real iPhone with production bundle ID.
2. CP3 blocked: after launch, the bottom Email tab ignored repeated Mirroring taps. This occurred before the repaired row path, so it cannot prove or reject the nested-button repair.
3. No Workspace 1 mutation or external side effect was performed. Resume by diagnosing the bottom-tab hit-test/routing state, then repeat CP3–CP6 on the same installed Build 353.

## Importance First category order — 2026-07-14

1. **Discovery:** `visibleInboxFilters` was the sole ordering authority. It surfaced system-style entries first and omitted the already-defined `.newsletter` filter. `InboxFilter` already contains all nine requested categories; no classifier, count, or stored data needed alteration.
2. **Maker:** reorder the visible list to `VIP, Priority, Action (.needsReply), Unread, Starred, Attachments, Notifications, Newsletters`, retain all remaining existing filters in their relative order, and remove/append `.all` last after dynamic provider filters. Rename only displayed chip copy to `Action`, `Newsletters`, and `All Mail`.
3. **Checker:** Xcode Beta Release unsigned build passed. Signed Build 354 archive/export passed under Team `4GGH43VE67`; IPA SHA-256 `5759da927c60a5115b9f4d5db3be25b2e941e7a9c0d91e6d672e809bb9bb3e47`. USB installation and launch succeeded on Bill's physical iPhone 17 Pro Max (sequence `6324`). Mirroring showed the requested leading order; Priority selection produced a non-empty real list (`10 visible`), captured in `artifacts/nexora-v3/production-app-real-iphone-20260714/build354-priority-filter-10-visible.jpeg` (SHA-256 `f2cd4ee1b74b685a61f23ef1d5551e90f54741d3471499f83f525990c9f2f642`).
4. **Evaluator finding / stop condition:** this UI-only task cannot truthfully close the mission's all-category data-switch criterion while authoritative Conversation Projection has no membership mapping for `VIP`, `Unread`, `Starred`, or `Attachments`. Do not silently fall back to provider/legacy classification: that would violate UCS authority. Add a separately reviewed projection-state contract before asserting full category parity. The visible bar's horizontal scroll remains safe by construction (no fixed chip width); largest Dynamic Type physical validation remains open.

## Email Tab interaction repair — 2026-07-14

1. **Discovery:** physical-device reproduction showed the old custom safe-area HStack did not provide an adequate reliable primary-navigation boundary under Mirroring. It was not a UIKit tab bar; no source-level competing gesture, reset, or disabled state existed. The test harness also incorrectly searched `tabBars` for a custom `Button`.
2. **Maker:** use native `TabView(selection:)` for the iOS Email, Intelligence, Goals, Trust, and Organization workspaces; keep selection tags and `mainTabBarHidden` through the system tab-bar toolbar. This delegates primary tab hit-testing and accessibility semantics to UIKit.
3. **Checker:** Build 356 unsigned Release compilation, manual archive/export, USB install and launch all passed. Real iPhone navigation from Goals into Inbox succeeded; Inbox visibly shows All Mail and the category bar. Evidence is `artifacts/nexora-v3/production-app-real-iphone-20260714/build356-email-tab-inbox.jpeg` (SHA-256 `1ef5194cde3adac2a53b2194de1d9b951fafe025f849e1d988cd633f92ae4b53`).
4. **Verdict:** PASS for the upstream Email Tab mission. Do not infer mail-row interaction acceptance from this result; proceed to the named downstream real-iPhone row/Star validation only.

## Importance First classification system revalidation — 2026-07-14

1. **Device:** Build 356 opened the repaired Email → Inbox route and showed `VIP, Priority, Action, Unread, Starred` in that order. The underlying source retains `Attachments, Notifications, Newsletters` immediately after, with `All Mail` appended last.
2. **Evaluator:** this is presentation proof, not category-authority proof. Current Priority selection rendered zero rows in this Workspace state; no all-chip scroll/selection loop can be marked complete. Projection-authoritative reads still have no membership contract for VIP, Unread, Starred, or Attachments.
3. **Verdict:** retain PARTIAL. The next maker task must implement and review portable Projection membership state before fresh real-device validation can truthfully close the classification system.
# Conversation Projection membership completion — 2026-07-14

1. **Authority contract (complete):** add `membership_keys_json`, retaining Facet Category as the sole source of `category_keys_json`.
2. **Materialization (complete):** derive `vip`, `unread`, `starred`, and `attachments` only from canonical state / normalized attachment evidence. Materializer version is `ucs-materializer-v2`.
3. **Historical safety (complete):** use fenced `ucs-projection-membership-v2` to append successor projections; do not delete or rewrite processing receipts.
4. **Parity (complete in code):** audit four membership surfaces in addition to the existing six surfaces; require zero missing/extra rows and the same audit epoch before any cutover.
5. **Production activation (complete):** migration `0056_projection_membership_contract.sql` applied; Worker `994be1b8-250e-4432-8a14-235372f63f86` deployed. Projection-read authority unchanged.
6. **Pending acceptance:** observe refresh and parity convergence; build/sign/install Build 357; validate VIP, Priority, Action, Unread, Starred, Attachments, Notifications, Newsletters, and All Mail on Bill's physical iPhone. Verdict remains PARTIAL until evidence exists.

## Canonical coverage repair — 2026-07-14

- The production baseline contained no canonical state for most historical workspace mail, which would make a canonical-only membership contract incomplete.
- Performed a scoped `INSERT OR IGNORE` backfill from authorized `workspace_account_bindings` plus the normalized `email` ledger. Existing state was never overwritten; generated canonical-state inserts are captured by the existing UCS outbox trigger.
- Verified zero missing canonical rows for both workspaces. This is an input-coverage repair, not a parity pass or a cutover change.

## v2 refresh acceleration — 2026-07-14

- Keep `processIngestOutbox` and the original UCS backfill at their conservative scheduled limit.
- Use a separate `membershipLimit: 100` only for the versioned `ucs-projection-membership-v2` fenced refresh. It remains cursor-resumable, append-only, and may not advance a parity/cutover verdict until `ready`.
- Deployed Worker `a04d61f5-40e0-47a2-9b22-63d19b18df06`; observe checkpoint, then require same-epoch four-membership audit before Build 357 device validation.

## Refresh runtime commit safety — 2026-07-15

1. **Discovery:** `conversation_materialization_checkpoints.processed_count` is updated only after the complete membership loop. A 500-item production attempt renewed its lease but did not commit its checkpoint; elapsed time and projection row growth are not acceptable completion evidence.
2. **Maker:** retain canonical-only membership materialization, five-minute fencing, generation validation, and automatic reclaim; lower only the scheduled `membershipLimit` to 25 so each cron execution can atomically release its checkpoint.
3. **Checker:** `npm run check` and the UCS reliability test (`8 passed`) succeeded on both corrective revisions. The migration safety gate passed on the first revision. Worker versions: 100-item `a1b350e9-2e8e-405f-8cba-55542b00d210`; bounded 25-item `7d7fef4b-ef23-4335-8b48-a96936be2a65`.
4. **Observed production state:** Workspace 2 reclaimed the membership lease at generation 23 on 2026-07-15 03:20:58 UTC; no unresolved pipeline failures were returned. Continue only from durable checkpoint commits. Do not create IPA, enable reads, or declare parity until both checkpoints are `ready` and the audit has one passing shared epoch.
5. **Second evaluator correction:** the 25-item version again renewed leases without advancing durable processed counts, so it did not meet the bounded-commit stop condition. Worker `9325bd2a-0efb-49ef-8793-0819ec61a13c` uses `membershipLimit: 1`; this preserves the same UCS-only materializer and fencing while making each scheduled commit independently observable. It passed syntax checking and 8/8 UCS tests. Completion is still pending durable production evidence.

## ADR — local transactional execution transport — 2026-07-15

1. **Decision:** an execution adapter may replace only the D1 transport. It must preserve prepared-statement parameters and submit `batch()` through the documented D1 HTTP Query API `{ batch: [...] }` form.
2. **Rejected:** Wrangler CLI SQL rendering and sequential execution. The former failed to provide binding-equivalent batch behavior; the latter would violate Projection Integrity.
3. **Implementation:** `d1-transactional-http-transport.mjs` implements `prepare`, `bind`, `first`, `all`, `run`, and one-request `batch`; `ucs-local-runtime.mjs` selects it only with `--transport=http`. Materializer, lease, generation fence, durable checkpoint, parity, and audit are untouched.
4. **Verification:** syntax checks and a mocked HTTP batch contract test pass. Production invocation requires an explicitly injected, scoped `NEXORA_D1_API_TOKEN`; credentials are never extracted from Wrangler or written to disk. Production commit/rollback, materialization, and parity evidence are pending that security boundary.

## Authorization-gate safe pause — 2026-07-15

1. **State:** `NEXORA_D1_API_TOKEN` is absent in the active execution environment. This is a presence-only check; no credential source was inspected.
2. **Boundary:** do not invoke the HTTP D1 transport, run a refresh, create a parity/audit epoch, build Build 357, or operate the device while authorization is absent.
3. **Resume:** begin with production commit and rollback verification only after a least-privilege D1 Read/D1 Write token is explicitly injected into the active environment. The next executable component is `d1-transactional-http-transport.mjs`; no UCS business or authority contract must be altered.

## External authorization stop condition — 2026-07-15

1. **Authorization state:** absent (presence-only verification).
2. **Stop condition:** external explicit authorization is required; do not retry completed verification, obtain credentials implicitly, or issue production writes.
3. **Resume point:** Production HTTP Batch Commit Verification, then Rollback Verification. Final status remains `PARTIAL — EXTERNAL_AUTHORIZATION_BLOCKED` until a scoped token is injected into the active environment.

## Runtime token propagation diagnosis — 2026-07-15

1. **Evidence:** active Codex shell and Node child both report token absent; their user is `billtin`; parent process is ChatGPT/Codex `app-server`; PM2 is absent.
2. **Finding:** the token exists, if at all, only in a different terminal process tree. It has not propagated into the actual Codex runtime that would execute the transport.
3. **Safe repair path:** relaunch the Codex execution host with the token explicitly in its inherited environment. Do not copy the token into chat, source it from a config, or inspect the terminal's environment. Re-run presence-only verification before production commit verification.

## ADR-UCS-WORKSPACE2-FRESHNESS — 2026-07-15

1. **Discovery:** production checkpoint `ucs-projection-membership:1:2` was `running` under generation 41 with an expired 13:18:34 UTC lease, no later heartbeat, `processed_count=1530`, and cursor `conversation:d1d2c9d0-4cec-4c1b-ac6c-10e6e029601f`. Aggregate-head comparison showed exactly 318 rows after that cursor.
2. **Maker (fence-safe recovery):** execute one conditional stale-lease release requiring the recorded checkpoint to remain `running` and expired. The update only set `state=paused`, cleared the owner and lease deadline, and recorded recovery time. It deliberately retained cursor, count, and generation history and never touched `conversation_projections`.
3. **Checker:** exactly one checkpoint row changed; a post-recovery read proved cursor/count/generation preservation. `npm run check` passed before the no-functional-change Worker redeployment. Deployment `5df32977-1f5f-48d9-b25a-63c6cf8eae30` confirmed `* * * * *` and daily cron bindings.
4. **Stop condition:** after the redeployment observation period, the checkpoint was still paused/unowned at generation 41 with lag 318. Persistent runtime telemetry had no `unifiedConversation` record after 13:16:30 UTC. This is scheduled-trigger non-delivery, not a valid reclaim. Do not start v3 rematerialization, call a local competing writer, or alter projections until delivery resumes and the production scheduler itself advances Workspace 2 to lag zero.

## UCS scheduled-delivery root-cause audit — 2026-07-15

1. **Scope discovery:** the production `conversation_cutover_state` query returns Workspace 2 with `dual_write_enabled=1`; source selects exactly those scopes. `projection_read_enabled=0` and rollout `0` do not participate in the scope predicate.
2. **Execution graph:** minute cron → `scheduled()` → awaited `runStep('unifiedConversation')` → `monitorScheduled()` → per-scope `refreshProjectionMemberships()`. No source branch omits Workspace 2.
3. **Telemetry model:** telemetry is invocation-scoped, not workspace-scoped. The last row at 13:16:30 UTC contains results for both workspaces, proving Workspace 2 was discovered and reached membership selection in the last delivered invocation.
4. **Checker finding:** the production audit ledger has no later runtime-step entry at all, including unrelated scheduled steps, despite the production deployment declaring the minute cron. The verified causal boundary is therefore upstream of Worker `scheduled()` entry, not Workspace 2 scope/filter/checkpoint logic. Classification: `OTHER_VERIFIED_CAUSE` (scheduled-event delivery absent before handler entry). No repair that writes projections or invokes a concurrent materializer is authorized by this finding.

## Cloudflare scheduled-delivery revalidation — 2026-07-15

1. **Version routing:** deployment `e394d646-23a1-46fb-97a4-42eeb815702e` routes `5df32977-1f5f-48d9-b25a-63c6cf8eae30` at 100%; deployment output bound `* * * * *`.
2. **Delivery and entry evidence:** audit-ledger records at 13:35:38 and 13:36:38 UTC show `invocationType=scheduled`, `step=unifiedConversation`, `ok=true`. This proves scheduled event delivery through the current Worker version, execution of `scheduled()`, `runStep`, and durable telemetry emission.
3. **Concurrent lease interpretation:** Workspace 2's `membership.claimed=false` in those telemetry payloads is correct contention behavior. A separate invocation owns generation 42 and advanced `processed_count` 1530→1609 and remaining cursor lag 318→239. It is not a checkpoint-selection, filtering, or delivery error.
4. **Decision:** supersede the prior provisional scheduled-non-delivery conclusion. Single classification: `OTHER_VERIFIED_CAUSE` — a transient observation gap, followed by verified delivery with a legitimate concurrent fenced writer. Preserve the one-writer contract and continue only through the deployed scheduler.

## Workspace 2 freshness gate — 2026-07-15

1. The natural writer advanced generation 42→43, processed 1609→1687, and lag 239→162; this is valid durable progress.
2. Generation 43 then expired without a final checkpoint commit or release. The conditional stale-lease recovery updated only state/owner/deadline and preserved the complete checkpoint history.
3. The next observation is paused/unowned with lag 162 and no later scheduled telemetry than 13:43:35 UTC. The required `lag=0` and head-cursor conditions are absent. V3 cannot be authorized until the production v2 scheduler repeatedly completes/reclaims to readiness.

## ADR-UCS-WORKSPACE2-FRESHNESS-COMPLETION — 2026-07-15

1. Read-only production audit at 13:53:32 UTC confirmed generation 43, cursor `conversation:e7979c37-8cc2-43c3-931a-af9b39e7d5b5`, aggregate head `conversation:fff3dc7b-5904-4c10-baf4-7bd9e130c080`, and exact remaining lag `162`.
2. The materializer's per-row lease renewal and checkpoint commit structure, plus durable 42/43 count/cursor changes, exclude renewal and ordinary checkpoint-commit failure for the completed rows. The missing terminal release and absence of telemetry after 13:43:35 UTC leave scheduled runtime termination/delivery gap as the verified causal boundary.
3. A read-only Worker-tail observation produced no later runtime telemetry. Workspace 2 is not fresh; V3 remains BLOCKED. See `docs/ADR-UCS-WORKSPACE2-FRESHNESS-COMPLETION.md` for the evidence package and resumption gate.

## Scheduler continuity remediation observation — 2026-07-15

1. Reattached the current production Worker's exact configured Cron triggers (`* * * * *`, `0 16 * * *`) without deploying code or altering D1/projections/checkpoints.
2. At three subsequent read-only observations through 13:59 UTC, the newest `unifiedConversation` audit event remained 13:43:35 UTC. The attachment exists, but execution continuity and Workspace 2 progress are still unproven; retain the V3 BLOCKED gate.

## UCS authoritative reconciliation and V3 scheduler repair — 2026-07-16

1. Production snapshot proves both v2 membership checkpoints terminal (W1 generation 272; W2 generation 127) and identifies 372/114 as W1 V3 only.
2. Confirmed root cause: `monitorScheduled()` selected both dual-write workspaces yet invoked the V3 rematerializer only for Workspace 1.
3. Repair schedules V3 for every selected dual-write scope through the unchanged bounded, lease-fenced `materialize()` path; no direct projection/checkpoint mutation and rollout remains 0%.
4. Checker passed syntax, focused UCS contracts (9/9), and package unit checks. Next gate is production deployment followed by observed non-null Workspace 2 V3 telemetry and durable checkpoint progress.

## Independent Workspace 2 V3 delivery audit — 2026-07-16

1. Production telemetry 1845–1915 verified that the active minute Cron repeatedly enters `unifiedConversation`, discovers both dual-write workspaces, and invokes the existing bounded V3 path for Workspace 2.
2. Workspace 2 checkpoint has durable continuation semantics: distinct key, generation 11, processed 55, persisted cursor, zero quarantine, and a paused/no-owner inter-cycle state. No competing writer, cursor reset, direct projection rewrite, or Workspace 1 contamination is evidenced.
3. Measured capacity is five rows per completed scheduler cycle. At the frozen snapshot lag 1979, `ceil(1979/5)=396` cycles remain; population growth makes the 6h36m nominal window conditional.
4. Scheduler delivery certification is complete. Continue only via the existing scheduler to terminal V3 state, then run fresh same-epoch parity; do not enable Workspace 2 projection reads.

## Workspace 2 V3 production scheduler certification — 2026-07-16

1. Deployment `40ff8b98-911d-49de-82b4-97ae6a374ad0` is 100% routed with `* * * * *` retained.
2. Three completed scheduler telemetry records (1845/1852/1859) show Workspace 2's own V3 result: claimed, five processed, zero failed. The checkpoint is persistent and was subsequently reread at generation 4 / processed 18.
3. Final cursor-lag snapshot is 2002. Capacity is measured—not assumed—as five durable rows per completed scheduler run; `ceil(2002/5)=401` cycles remain, conditional on no target growth.
4. Do not use this traversal forecast to certify parity or cutover. Continue through the single deployed scheduler until terminal checkpoints, then run one fresh same-epoch audit.

## UCS V3 claim-only recovery — 2026-07-16

1. **Discovery:** audit ID 1838 is the last native scheduled V3 run. Generations 103–114 have no durable checkpoint, cursor, failure, quarantine, or projection-provenance delta despite 1,587 eligible rows.
2. **Maker:** disable the Wrangler-backed local V3 adapter entry point. Native scheduled code remains the only authority and retains `materialize()`, leases, generation fencing, durable cursor commits, and terminal release.
3. **Checker:** run syntax and reliability checks. Then confirm a native scheduled telemetry event correlates to a reclaimed generation, `processed_count>372`, cursor advance, projection commits, and a normal release.
4. **Stop condition:** never reset cursor/checkpoint or mutate projections directly. No parity or FULL_PRODUCTION_PASS decision precedes successful native recovery.

5. **Observed recovery:** version `1134b1cb-171f-419e-b35f-be5752352af5` restored native scheduled telemetry IDs 1866/1873. Generation 117 reached count 382 with cursor advancement and normal release. Continue the bounded native migration; parity remains gated on terminal ready.

## Counter identity reconciliation completion — 2026-07-16

- [x] Query raw D1 rows using full checkpoint IDs and tenant/workspace/pipeline identity.
- [x] Separate Workspace 1 `lease_generation=132 / processed_count=457` from Workspace 2 `lease_generation=19 / processed_count=95`.
- [x] Validate post-gap native cron recovery with two contiguous Workspace 2 telemetry and durable-checkpoint advances under Worker `a81acb6e-03f6-4e00-a06e-5ecaf4e03603`.
- [ ] Resume forecast only from the scoped Workspace 2 checkpoint and continuing native telemetry; do not reuse unscoped heartbeat counters.
- [ ] At `state=ready`, capture one same-epoch 10-surface audit package before any read enablement or acceptance declaration.

## Failed outbox resolution — 2026-07-16

- [x] Identify raw failed outbox identity and root cause: deleted canonical mail with no conversation binding.
- [x] Add and test the narrow normal-ingest `source_removed` terminal semantic; deploy Worker `338018fc-7c51-4740-80e4-fc0388357441`.
- [x] Capture a post-deployment minute-cron claim proving the row becomes `processed` through the normal ingest path (`processed/source_removed`, attempt 62, `2026-07-16 01:43:12 UTC`).
- [ ] Continue scoped 15-minute monitoring until outbox, checkpoint, coverage, and same-epoch parity gates pass.

## Renewed scheduler-continuity blocker — 2026-07-16

- [x] Execute the corrected remote read-only production D1 invocation; capture its successful result and tombstone no-regression evidence.
- [x] Establish active deployment chain: Worker `338018fc-7c51-4740-80e4-fc0388357441` is 100% routed.
- [ ] Obtain native scheduler evidence that reclaims or cleanly releases the expired W2 V3 lease (generation 39) without manual checkpoint action.
- [ ] Resume convergence forecasts only after durable V3 continuity returns; retain all parity gates and projection reads disabled.

## Native lease recovery certification — 2026-07-16

- [x] Correlate pre-expiry claimed-false telemetry to the still-active lease and source CAS predicate.
- [x] Verify a normal post-expiry scheduler reclaim and at least two consecutive five-row, zero-failure Workspace 2 V3 cycles.
- [x] Verify durable continuation: `39/192 → 55/272`, cursor advancement, normal paused/unowned release, and Workspace 1 isolation.
- [ ] Continue convergence monitoring; a later intermittent minute-runtime gap does not negate the completed native reclaim proof but prevents treating the cadence as guaranteed.

## Monitor authorization interruption — 2026-07-16

- [x] Verify that the failed monitor request was rejected before production SQL execution (Cloudflare API 403/7403).
- [ ] Restore authorized production-D1 query access, then rerun the unchanged scoped read-only monitor bundle before deriving any new deltas or forecasts.

## Completion monitor stall — 2026-07-16 02:13 UTC

1. **Discovery:** exact-identity read-only sampling shows Workspace 2 frozen at generation 39 / processed 192 with an expired `running` lease and no completed `unifiedConversation` telemetry after 01:55:24 UTC.
2. **Checker:** coverage remains 522/2,068 with 1,546 missing, cursor remaining 1,873, pending outbox 1,742, unresolved failures 0, duplicates 0, and orphans 0. The target tombstone remains normally resolved.
3. **Isolation:** Workspace 1 is separate and active at generation 161 / processed 586 / quarantine 25; its counters are not Workspace 2 acceptance evidence.
4. **Stop condition:** continue read-only observation only. Do not run the formal audit until Workspace 2 is ready, released/stable, exact-coverage and cursor gates are zero, outbox non-processed is zero, and failures are zero.

## D1 authorization recovery — 2026-07-16

- [x] Verify target configuration and OAuth-only credential precedence without exposing secrets.
- [x] Recover read access using the existing OAuth refresh path; verify a `SELECT 1` probe and full scoped sample with `rows_written=0`.
- [ ] Monitor fresh scheduler/checkpoint continuity: latest successful W2 telemetry is still 10:31 UTC, so no cadence-based completion claim is valid.
# UCS Workspace 2 V3 monitor loop — 2026-07-16 01:27 UTC

1. **Discovery:** compare the certified 01:07:23 baseline (generation 11, processed 55, target 2,034, remaining 1,979, V3 current 314) to a read-only D1 sample.
2. **Evaluator result:** generation 19 / processed 95 is paused and unowned with quarantine 0, but remaining is 1,953, coverage is only 377/2,049, target growth continues, latest UCS telemetry is 01:14:34, and ingest outbox is 1,785 pending plus 1 failed. Gate remains closed.
3. **Reconciliation:** target +15; processed +40; remaining equation yields 41 because one new aggregate landed at/before the current cursor. Net V3 coverage +63 consists of the 40 traversal commits plus legitimate atomic/live rematerialization and replacement effects; never classify those live paths as competing writers.
4. **Forecasts:** V3 is 391 successful five-row cycles (~6h31m) conditional on restored minute delivery and no growth. The observed ingest window drained 16 and added 3 across eight cycles; pending drain is approximately 893 cycles gross or 1,100 cycles net, with the failed row independently unresolved.
5. **Stop condition:** do not run parity until ready, stable, unleased, quarantine 0, target stable, exact V3 coverage, zero unresolved failures, and outbox 0. No parity ran in this loop, so no same-epoch post-audit sequence exists to recheck.

## Post-10:31 continuity audit — 2026-07-16

- [x] Validate authorization, complete a fresh scoped read-only sample, and compare checkpoint/outbox/coverage to the 13:05 valid sample.
- [x] Establish that no global runtime step exists after 10:31:36 and no W2 durable state advances after 10:31:24.
- [ ] Continue observation for native runtime recovery. Do not infer which upstream boundary failed or deploy a speculative repair.

## Generation-243 evidence loop — 2026-07-16

1. **Discovery/evaluation complete:** exact-key remote D1 sampling proves the supplied generation `243` / count `789` fact belongs to W1 (`...:1:1`), while W2 (`...:1:2`) remains `78/387`.
2. **Verdict:** **MONITOR_FIELD_OR_EPOCH_MISMATCH**. The W1 claim and lease expiry cannot prove a W2 rematerializer boundary or W2 zero-progress cycle.
3. **Remaining gate:** no persisted runtime step exists after `10:31:36 UTC`; current evidence cannot distinguish platform cron non-delivery from handler non-entry. Continue SELECT-only observation and wait for native evidence; do not alter runtime state or run parity.

## Scheduled-runtime recovery loop — 2026-07-16 13:32 UTC

1. **Generator:** add an identity-only monitor contract and exact four-key query shape; update the monitor automation to fail on missing or ambiguous W2 evidence rather than selecting an unscoped checkpoint.
2. **Checker:** syntax, 6 monitor-isolation regressions, and 10 UCS scheduler contracts pass. A remote, SELECT-only production sample confirms `rows_written=0`.
3. **Production outcome:** new 100%-routed Worker `101308e4-0faf-4ecc-897d-6fd47753a012` has normal minute-runtime telemetry from 13:27 through 13:31. Each W2 result is explicitly workspace 2 with claimed/processed/failed `true/5/0`; Gmail also succeeded. W2 is now generation `84`, processed `415`, cursor advanced from the 78/387 baseline.
4. **Verdict:** `TRANSIENT_PLATFORM_GAP_RECOVERED`. A platform trigger receipt is not available, so the historical pre-entry cause remains unobservable; observed post-recovery cycles prove handler/orchestration/runtime activity. Continue bounded native convergence only—W2 is not ready and parity remains forbidden.

## Convergence interruption observation — 2026-07-16 13:38 UTC

1. **Discovery:** exact W2 read-only samples show one more durable bounded batch (`84/415`, cursor advanced) after the five telemetry-linked cycles, then an unchanged `running` record with lease expired at `13:37:26 UTC`.
2. **Evaluator:** no runtime telemetry is persisted after W2 audit `2453` at `13:31:33 UTC`; no observation supports a manual or competing writer. This is not a ready, stable, or parity-eligible condition.
3. **Stop condition:** await native expired-lease reclaim through the existing minute cron and monitor. Do not release/reset the lease, invoke the scheduler/rematerializer, or run parity. Current V3 and outbox gates remain materially open.

## Completion-blocker RCA — 2026-07-16 13:58 UTC

1. **Evidence:** the native scheduler reclaimed the expired W2 lease, advanced to `97/480`, and cleanly released; repeated scheduled audit records prove current W2 V3 processing and Gmail telemetry.
2. **Decision:** no unique historical generation-84 interruption cause remains in retained production evidence. Do not modify production runtime state to address an unproven component.
3. **Next:** continue native, exact-identity, read-only convergence monitoring; completion/parity remain blocked by non-ready and nonzero outbox gates.

## W2 completion convergence loop — 2026-07-18 03:56 UTC

1. **Discovery:** exact-key, SELECT-only production D1 sampling returned exactly one W2 row and kept the separately exact W1 row isolated. W2 is unchanged at generation/count `251/1244`, paused/unowned/unleased, with target/current/missing `2173/1550/623`, remaining `1488`, and outbox pending/processing/processed/failed `1586/1/1327/0`.
2. **Evaluator:** duplicates, orphans, unresolved failures, and tombstone regressions remain zero, but W2 has no telemetry or durable movement after `01:50:26/01:50:14 UTC`. This is a stale runtime condition, not a readiness boundary; W1's independent activity is excluded.
3. **Stop condition:** keep the mission `IN_PROGRESS_W2_STALLED`. Continue read-only exact-identity observation only. Do not run parity until W2 is ready, fresh and stable, outbox non-processed is zero, and exact frozen-scope coverage/cursor lag are zero; do not enable reads or declare `FULL_PRODUCTION_PASS`.

## NEXORA Zero-Touch onboarding kernel — implementation plan (separate work stream, 2026-07-18)

Not part of UCS W2 convergence; recorded additively per Required Output #33 of the Zero-Touch OAuth Logic
Completion mission. Checkpoints completed this pass: compensation (2), OAuth/session contract (3), Google PKCE
(5), Microsoft PKCE (6), scope planning/incremental consent/identity/tenant/capability discovery (7 — partial,
see matrix), admin bootstrap packages/config template/runbook (10), CI/secret-scan (11), matrix + verdict (12).

Remaining checkpoints, in order, none requiring further architecture decisions:
1. Onboarding-specific 18-state machine with its own `assertTransition`-style guard (currently only the
   generic Mission Runtime state machine is real; `nexora_onboarding_state` has the columns, not the guard).
2. `/v3/onboarding/*` API routes: start, callback/google, callback/microsoft — wiring `createAuthorizationSession`/
   `consumeCallback` (already implemented and tested) to HTTP, and resuming the linked Mission on success.
3. Token storage/refresh/rotation (blocked on a real client_secret to test against meaningfully — Checkpoint 13).
4. Initial sync flow (blocked on #3).
5. Operational-visibility extension of `mission-runtime-status-service.js` for onboarding-specific fields.
6. Zero-Touch scorecard (requires #2-#4 working end-to-end to measure).
7. Checkpoint 13+: inject real credentials per the admin bootstrap packages, execute
   `NEXORA_PROVIDER_ACCEPTANCE_RUNBOOK.md` Steps 3-9 for production/desktop/real-iPhone acceptance.

Durable checkpoints: commit `b72f2ec` (compensation), commit `7a0ffd0` (OAuth logic). Full suite 328/328.
