# NEXORA Checkpoint 4 Dependency and Runtime Report

Date: 2026-07-22
Branch: `codex/nexora-checkpoint4-production`
Base: `066ffb2515187b56ceb9fa2e3015c8ff594aefc1`
Deployment source: top-level `mail-worker`

## Dependency root cause and resolution

Environment: Node 22.22.3, npm 10.9.8, Darwin arm64. Clean `npm ci` initially produced five high findings representing GHSA-f88m-g3jw-g9cj across sharp, Miniflare, Wrangler, the Vitest pool, and the unused Vite plugin. Direct/transitive graph and decisions are in ADR-007.

Resolution: remove unused production Vite plugin and override sharp to 0.35.3. After clean install, `npm audit --json` reports 0 vulnerabilities. The Wrangler production dry-run succeeds and bundle inspection finds no sharp, libvips, Miniflare, or Wrangler package marker. The dependency scanner reports 0 high/medium/low vulnerabilities across its inventory. Its license classifier is conservative and reports unresolved repository-license/metadata ambiguity; this is recorded, not suppressed.

## Runtime integration and controls

Exactly one capability descriptor and adapter are registered: `search_email`. The scheduler is default-off and emergency-disabled by default. Exact tenant, workspace, and capability allowlists, one-per-tick and one-per-minute budgets, 20-result cap, 2-second maximum timeout, 30-second lease, circuit breaker, immutable authority context, authority-generation and fencing checks, Evidence append, independent Verification append, and verified-only Mission completion are implemented.

Provider coupling delta: one new Gmail-named adapter reads only `email` and `account` in canonical D1. Delta for provider HTTP calls, OAuth, credential reads, mailbox writes, send/draft actions, or legacy runner calls is zero.

Capability coverage delta: `search_email` moves from locally invokable to scheduled-runtime integrated. `read_thread`, `fetch_message`, `send_email`, `draft_reply`, `classify_email`, `watch_mailbox`, and `get_delta` remain disabled/unimplemented in this production scheduler. Microsoft remains contract-fixture-only.

## Comail provenance and reuse decision

Authorization reference: Checkpoint 4 mission. Exact repository: `NextOSP/comail`; release/tag `v0.2.25`; commit `d068e09bc0511213754964f2e0a6ab9481121663`; default branch `master`; license AGPL-3.0. Inspected paths include `src-tauri/crates/comail-core/src/scheduler/mod.rs`, `queue/mod.rs`, and `sync/engine.rs`.

Classification: `REFERENCE_ONLY_NO_CODE_REUSE`. Direct code/dependency reuse was rejected because Comail's Rust/Tauri local actor, IMAP/SMTP queue, credential, and SQLite architecture does not fit the Cloudflare server-authoritative Mission/Evidence/Authority boundary, and its AGPL licensing would require a separate legal decision. The exact repository did validate bounded slices, retry caps, timer nudges, and connection-failure classification as relevant comparison points. No Comail source, fixture, dependency, or notice-bearing artifact was copied.

## Verification snapshot

- Focused scheduled capability: 1 file / 10 tests PASS, including forced rollback when the Mission completion write affects zero rows.
- Complete canonical Worker reliability suite: 18 files / 192 tests PASS.
- Worker syntax and unit contracts: PASS.
- Clean install and npm audit: PASS, 0 vulnerabilities.
- Wrangler production dry-run: PASS with the exact immutable source SHA embedded as build identity.
- Production bundle reachability: sharp/libvips/Miniflare/Wrangler absent.
- `git diff --check`: PASS.
- Independent adversarial review: five initial P1 findings and one production-remediation P2 finding were remediated; final re-review confirms no remaining P0/P1/P2 in scope.

## Immutable release and deployment evidence

- Branch: `codex/nexora-checkpoint4-production`
- Base: `066ffb2515187b56ceb9fa2e3015c8ff594aefc1`
- Initial reviewed implementation: `fa8a0aee65ed09e9048d913b41659eb0d11964af`
- Production-remediated final source: `32eb8fbd74455ba5fdcdf6e64de2392360ffbc99`
- Pull request: `https://github.com/billyadult002/cloud-mail/pull/9`
- Review record: `https://github.com/billyadult002/cloud-mail/pull/9#issuecomment-5053391433`, plus final independent Checker re-review with no P0/P1/P2.
- Exact final source deployment: Worker version `8ad4bcf4-41e9-4471-b305-332e1c3a1df6`, 2026-07-23 UTC.
- Final active rollback configuration version: `f5e489d0-9e76-4234-80f9-63b7e5951438`.
- Production migration status: no migrations to apply.

The first production acceptance against the initial implementation correctly produced read-only Evidence and Verification, but exposed a lifecycle defect: the Mission completed while its run remained `running`. Acceptance stopped, controls were disabled, the run-completion transition was made fenced and atomic with abort-on-zero guards, a forced-failure D1 regression was added, and the remediated commit was independently re-reviewed before redeployment.

## Redacted production configuration

- Capability allowlist: exactly `search_email`.
- Global feature state after acceptance: `enabled=false`.
- Emergency control after acceptance: `emergency_disabled=true`.
- Tenant fingerprint: `22c15c00c0a20f10a00ddc92b8671249ed3b8ea1e47ca74e69ac80d4248ce869`.
- Workspace fingerprint: `02c77464e34542edf7978fffc7447097084f0df416b85dce329f6acde1cd6b1d`.
- Account fingerprint: `233e9376afdad0440a1376f16b831940659747933733aeb838a94d5762975ceb`.
- Final configuration fingerprint: `a1b308daf471da7292a4c929e717748305cb5f4e62ec20da0047fced5b4e99b4`.

The raw tenant, workspace, and account identifiers are deliberately excluded from the evidence artifact. Secret values were entered through Wrangler's masked prompt and did not enter source, reports, or command arguments.

## Production acceptance trace

The canonical `* * * * *` scheduled trigger claimed one allowlisted production job at `2026-07-23 02:00:15` UTC. The non-content search returned zero references and recorded `read_only=true`.

- Job: `19`, state `SUCCEEDED`, attempts `1`.
- Mission: `scheduled-search-19-mission`, state `completed`, version `4`.
- Run: `scheduled-search-19-run`, state `completed`, fencing token `1`, version `3`, lease cleared.
- Action: `scheduled-search-19-action`, capability `search_email`, type `READ_ONLY_CANONICAL_MAIL`, state `completed`, authority generation `0`; target and parameter hashes are 64 characters.
- Authority audit: `VERIFIED_ACTION` / `READ_MAIL` / `ALLOW`, generation `0`, Mission correlation true, 64-character scope hash.
- Evidence: `16b6797c-885b-42a2-b38f-af1121c42f43`, `supported`, 64-character reference and integrity hashes, restricted runtime-audit metadata.
- Verification: `a8e38e70-f3fc-4471-8522-a8d8a7d2fad7`, `verified`, integrity `valid`, verifier `capability_contract_v1`, Evidence correlation true.
- Outcome: `verified`, policy `capability_contract_v1:1`, Action and Verification correlations true.
- Scheduled audit flags: `provider_network_called=0`, `credential_accessed=0`, `mailbox_mutated=0`.
- Cross-scope Mission rows: `0`.

This is authenticated server-authority proof over canonical production Gmail-sourced D1 rows. It is not a live Google Provider API call, new OAuth proof, real-time synchronization proof, or account-linking proof. The adapter intentionally has no provider-network or credential path.

## Negative production verification and rollback

- Non-allowlisted tenant, non-allowlisted workspace, and unsupported capability probes remained `QUEUED` with attempt count `0` across enabled cron ticks; they were then durably marked `BLOCKED` with `CHECKPOINT_4_ALLOWLIST_REJECTION_VERIFIED` after rollback.
- A stale authority-generation probe was claimed once and failed with `executed=false`, `capability_authority_generation_stale`, and no Evidence or verified Outcome.
- A malformed empty-query probe was claimed once and failed with `executed=false`, `capability_schema_invalid_query`, and no Evidence or verified Outcome.
- Read-only production-state predicates confirmed missing membership rejection, inactive/stale lease rejection, and incorrect fencing-token rejection.
- Failed probes promoted zero Missions without valid verified Evidence.
- Real-D1 executable tests separately cover conflicting replay digest, changed-input pre-Evidence retry, missing Verification, adapter safety-flag regression, emergency disable, exact allowlists, and default-off behavior.
- After emergency-disable and feature-disable were restored, a valid rollback probe remained unclaimed across a cron tick, with attempt count `0` and no Mission row; it was then marked `BLOCKED` with `CHECKPOINT_4_ROLLBACK_VERIFIED`.
- Evidence from the successful run remained readable after rollback. Worker HTTP health returned `200`, the scheduled trigger continued returning `Ok`, and no migration was pending.

## Capability coverage and unresolved register

| Capability | Checkpoint 4 production state |
|---|---|
| `search_email` | One bounded scheduled canonical-D1 acceptance passed; globally disabled after rollback |
| `read_thread`, `fetch_message` | Disabled / not integrated |
| `send_email`, `draft_reply` | Disabled; no provider-write path enabled |
| `classify_email`, `watch_mailbox`, `get_delta` | Disabled / not integrated |
| Microsoft capabilities | Contract-fixture-only; no live-provider claim |

EMAIL_TAB_INTERACTION_FAILURE, classification redesign/production verification, earlier Domain Authority P1 items, real-time Sync Runtime, Connection Runtime, OAuth/linking recovery, Microsoft live-provider integration, and all provider-write capabilities remain outside this checkpoint and unchanged. Existing repository-license metadata ambiguity remains recorded; it is not a runtime dependency blocker under the applied production policy.

Final verdict: `CHECKPOINT_4_PRODUCTION_PASS`.
