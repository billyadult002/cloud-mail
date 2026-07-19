# NEXORA Comail-First Compatibility Audit

Assessment date: 2026-07-18

Mission: `NEXORA COMAIL-FIRST REVIEWABLE INTEGRATION AND PRODUCTION ACCEPTANCE CONTINUATION`

Review branch: `codex/nexora-production-integration-5d7024d`

PR: https://github.com/billyadult002/cloud-mail/pull/1

## Authority

- Authorization reference: `USER_CONFIRMED_FORMAL_COMAIL_AUTHORIZATION_2026-07-18`
- Authorized source repository: `https://github.com/NextOSP/comail`
- Inspected source commit: `38960219de19812bcb8dbd562ee91974e0787737`
- Inspected source branch: `master`
- Inspected package version: `0.2.22`
- License declared by `package.json` and `src-tauri/crates/comail-core/Cargo.toml`: `AGPL-3.0-only`
- Local inspection checkout: `/Users/billtin/Documents/cloudmail/.external/comail`

No Comail source code, comments, fixtures, tests, bundled assets, generated code, or dependencies are copied, translated, imported, vendored, or linked by this PR. The PR uses Comail as an authorized implementation reference and compatibility gate for overlapping email, OAuth, Provider, synchronization, and retry behavior.

## Direct-Reuse Decision

Decision: `COMAIL_GUIDED_IMPLEMENTATION_NO_DIRECT_CODE_REUSE`

Direct copy or translation is rejected for this PR because Comail is a Tauri/Rust desktop email client with local keyring, local SQLite, IMAP/SMTP protocol flows, and app-local synchronization authority. NEXORA's implementation in this PR is a Cloudflare Worker, D1-backed, server-authoritative onboarding and callback continuation system with Tenant and Workspace authority, Durable Mission Runtime, Evidence Ledger, Verified Action Boundary, Provider capability contracts, leases, fencing, generations, and exact-once continuation.

The AGPL-3.0-only license is also a production-governance boundary. Since no Comail code or assets are included, this PR does not introduce Comail license notices, corresponding-source obligations, or third-party dependency obligations into the Worker artifact. Any future direct copy, translation, or dependency import must be approved and recorded before implementation.

## Capability Matrix

| Capability | Comail source | NEXORA destination | Classification | Decision and rationale |
| --- | --- | --- | --- | --- |
| OAuth authorization-code flow with PKCE and state | `src-tauri/crates/comail-core/src/oauth/flow.rs` | `mail-worker/src/service/nexora-onboarding-oauth-service.js`, `mail-worker/scripts/reliability-tests/nexora-onboarding-oauth.test.mjs` | `PATTERN_ONLY` | Comail validates random PKCE verifier, S256 challenge, loopback callback, and state mismatch fail-closed behavior. NEXORA keeps its server-generated session/correlation model instead of desktop loopback authority. |
| Provider OAuth configuration | `src-tauri/crates/comail-core/src/oauth/providers.rs` | `mail-worker/src/service/provider-capability-contract-service.js`, `mail-worker/src/service/nexora-onboarding-provider-discovery-service.js` | `COMAIL_GUIDED_IMPLEMENTATION` | Comail confirms provider-specific endpoints, incremental-consent shape, and Microsoft resource-scope separation. Direct scope reuse is rejected because Comail uses IMAP/SMTP scopes while NEXORA uses Provider API capability contracts. |
| Token refresh and reauth classification | `src-tauri/crates/comail-core/src/oauth/tokens.rs` | `mail-worker/src/service/nexora-onboarding-token-exchange-service.js`, `mail-worker/src/service/nexora-onboarding-token-storage-service.js`, `mail-worker/src/service/nexora-onboarding-token-lifecycle-service.js`, `mail-worker/src/service/nexora-onboarding-refresh-scheduler-service.js` | `COMAIL_GUIDED_IMPLEMENTATION` | Comail's access-token freshness window, refresh failure classification, and `invalid_grant` reauth semantics inform NEXORA. Direct reuse is rejected because Comail stores refresh tokens in local keyring and caches access tokens in memory, while NEXORA requires encrypted Worker/D1 state with tenant/workspace fencing. |
| OIDC identity extraction and verification | `src-tauri/crates/comail-core/src/oauth/flow.rs` | `mail-worker/src/service/nexora-onboarding-token-exchange-service.js`, `mail-worker/src/service/nexora-onboarding-orchestrator-service.js`, `mail-worker/scripts/reliability-tests/nexora-onboarding-token-exchange.test.mjs`, `mail-worker/scripts/reliability-tests/nexora-onboarding-orchestrator.test.mjs` | `COMAIL_GUIDED_IMPLEMENTATION_WITH_PRODUCTION_HARDENING` | Comail decodes account email from `id_token` but does not provide JWKS verification. NEXORA preserves the identity-extraction behavior category and adds Provider JWKS RS256 verification, issuer/audience/expiry/nonce checks, and fail-closed blocking before token storage. |
| XOAUTH2 protocol login | `src-tauri/crates/comail-core/src/oauth/xoauth2.rs`, `src-tauri/crates/comail-core/src/imap/mod.rs`, `src-tauri/crates/comail-core/src/smtp/mod.rs` | No direct PR destination | `NOT_APPLICABLE_TO_THIS_PR` | The current PR does not implement IMAP/SMTP protocol sessions. Future Provider-adapter work must reassess these modules before implementing XOAUTH2. |
| Message parsing and composition | `src-tauri/crates/comail-core/src/mime/mod.rs` | Existing `mail-worker/src/service/email-service.js` send-contract hardening only | `NOT_APPLICABLE_TO_THIS_PR` | The PR preserves remote-main mail sending and only hardens recipient normalization and cc/bcc persistence. It does not import Comail MIME parsing or composition. |
| Synchronization engine | `src-tauri/crates/comail-core/src/sync/engine.rs`, `src-tauri/crates/comail-core/src/sync/threading.rs`, `src-tauri/crates/comail-core/src/sync/folder_map.rs` | `mail-worker/src/service/nexora-onboarding-sync-service.js` | `PATTERN_ONLY` | Comail's bounded sync, reconnect, polling/IDLE, and folder mapping validate the need for explicit retry and completion states. Direct reuse is rejected because NEXORA sync completion is server-authoritative onboarding state, not local mailbox mirror state. |
| Offline queue and retry behavior | `src-tauri/crates/comail-core/src/queue/mod.rs` | `mail-worker/src/service/nexora-onboarding-refresh-scheduler-service.js`, `mail-worker/src/service/nexora-onboarding-evidence-outbox-service.js`, `mail-worker/src/service/nexora-callback-continuation-service.js` | `PATTERN_ONLY` | Comail's atomic claim, max-attempt, exponential-backoff, and auth-pause behavior maps to NEXORA retry and outbox expectations. Direct reuse is rejected because NEXORA requires D1 leases, fencing, generations, Evidence Ledger records, and exact-once mutation ownership. |
| Desktop UI and local runtime | `src/`, `src-tauri/` | No direct PR destination | `NOT_APPLICABLE_TO_THIS_PR` | The PR changes Worker-side production onboarding logic and review artifacts only. Desktop acceptance remains a separate production gate. |
| Tests and fixtures | `src-tauri/crates/comail-core/tests/*.rs`, `src-tauri/crates/comail-core/tests/support/smtp_sink.py` | `mail-worker/scripts/reliability-tests/*.test.mjs` | `PATTERN_ONLY` | Comail tests inform categories for OAuth, sync, send, labels, search, and offline behavior. No Rust/Tauri tests are copied because the NEXORA Worker test harness is JavaScript/Vitest/workerd-shaped. |

## Behaviors Preserved In NEXORA Design

- PKCE S256 and random verifier behavior are required before an OAuth callback can produce a completion.
- OAuth `state` or correlation mismatch must fail closed and must not mutate durable Provider state.
- Provider configuration must be capability-contract driven, not hardcoded as a desktop account preference.
- Token refresh failures must distinguish reauthorization-required conditions from transient retryable failures.
- Retry work must be bounded, observable, and recoverable after process restart.
- Auth failures must pause or stop unsafe Provider mutations rather than continuing blind.
- Access-token and refresh-token evidence must be redacted; raw Provider credentials must not be persisted in evidence.

## Behaviors Rejected For NEXORA

- Desktop loopback OAuth authority replacing server-authoritative authorization sessions.
- Local keyring token authority replacing NEXORA tenant/workspace-bounded encrypted Worker storage.
- Local SQLite sync authority replacing Durable Mission Runtime, Evidence Ledger, leases, fencing, and generations.
- IMAP/SMTP scopes replacing Provider-Agnostic Capability Contracts for Gmail/Graph API work.
- Tauri desktop process lifecycle replacing Worker restart and takeover safety.
- Comail personal-client account authority replacing NEXORA enterprise Tenant and Workspace authority.

## License And Dependency Impact

- License: `AGPL-3.0-only`
- Comail dependencies introduced by this PR: none
- Comail assets introduced by this PR: none
- Comail notices required in this PR artifact: none, because no Comail code or assets are copied, translated, linked, bundled, or imported
- Future direct-use requirement: record copied/translated/adapted source path, destination path, function/module, modifications, dependencies, notices, tests, Worker/Desktop/IPA usage, and production usage before implementation

## Worker, Desktop, IPA, And Production Impact

- Worker: Comail is used as an audit and design reference for OAuth, token lifecycle, retry, and sync behavior. No Worker dependency is added.
- Desktop: no desktop source changes in this PR. Desktop acceptance remains required before `PRODUCTION_AND_REAL_DEVICE_PASS` if authenticated desktop behavior is part of the final production gate.
- IPA/iPhone: no IPA source changes in this PR. Real-device acceptance remains required before final production pass.
- Production: no Provider registration, secret injection, deployment, migration execution, or production data mutation is performed by this audit.

## Verification Mapping

- NEXORA OAuth/correlation coverage: `mail-worker/scripts/reliability-tests/nexora-onboarding-oauth.test.mjs`
- NEXORA token exchange coverage: `mail-worker/scripts/reliability-tests/nexora-onboarding-token-exchange.test.mjs`
- NEXORA refresh scheduler coverage: `mail-worker/scripts/reliability-tests/nexora-onboarding-refresh-scheduler.test.mjs`
- NEXORA sync completion coverage: `mail-worker/scripts/reliability-tests/nexora-onboarding-sync.test.mjs`
- NEXORA evidence outbox coverage: `mail-worker/scripts/reliability-tests/nexora-onboarding-evidence-outbox.test.mjs`
- NEXORA callback exact-once coverage: `mail-worker/scripts/reliability-tests/nexora-callback-continuation-exact-once.test.mjs`
- NEXORA failure and revocation matrix: `mail-worker/scripts/reliability-tests/nexora-onboarding-failure-revocation-race-matrix.test.mjs`

## Final Audit Verdict

`COMAIL_FIRST_AUDITED_WITH_GUIDED_PATTERNS_NO_DIRECT_REUSE`

Comail materially improves this PR by supplying an authorized reference for OAuth, token refresh, Provider scope separation, retry, sync, and offline-failure categories. It does not replace NEXORA's Worker-side authority model, and it is not copied into the review branch.
