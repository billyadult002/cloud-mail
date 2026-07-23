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

- Focused scheduled capability: 1 file / 9 tests PASS.
- Complete canonical Worker reliability suite: 18 files / 191 tests PASS.
- Worker syntax and unit contracts: PASS.
- Clean install and npm audit: PASS, 0 vulnerabilities.
- Wrangler production dry-run: PASS after explicit non-secret candidate build identity.
- Production bundle reachability: sharp/libvips/Miniflare/Wrangler absent.
- `git diff --check`: PASS at current snapshot.
- Independent adversarial review: five initial P1 findings remediated; re-review confirms no remaining P0/P1.

## Unresolved and production gates

Production deployment, authenticated production D1 acceptance, production negative probes, and observed rollback are not local-test facts and remain pending until the exact reviewed commit and PR exist. EMAIL_TAB_INTERACTION_FAILURE, classification redesign/verification, earlier Domain Authority P1 items, real-time Sync Runtime, Connection Runtime, OAuth/linking recovery, Microsoft live-provider integration, and all provider-write capabilities remain unchanged.

Current verdict: `CHECKPOINT_4_LOCAL_RELEASE_CANDIDATE_PASS — PRODUCTION_ACCEPTANCE_NOT_COMPLETE`.
