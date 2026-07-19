# NEXORA Comail Reuse Assessment — 2026-07-18

## Source and permission boundary

### Internal-use authorization update — 2026-07-18

`authorization_status: USER_CONFIRMED_PENDING_ARTIFACT`
`confirmed_by: TinBill`
`confirmation_date: 2026-07-18`

The user has authorized internal NEXORA/CloudMail development, testing, adaptation, source
translation, dependency/fixture/test reuse, Worker integration, IPA integration, and
production-readiness implementation of Comail 0.2.22. The formal authorization artifact has
not yet been attached. This record does not invent an authorizing legal entity, document ID,
signature date, territory, sublicensing rights, or notice waiver.

Directly reused Comail code remains blocked from commercial release, public distribution,
external binary distribution, and externally accessible deployment until the formal artifact is
attached, reviewed, and correlated. The pre-authorization DESIGN_REUSE assessment below is
preserved as historical evidence.

Assessment source: `/Users/billtin/Downloads/comail-0.2.22`, package version `0.2.22`.
The supplied source tree has no readable Git revision metadata. Its `package.json` declares
`AGPL-3.0-only`; `LICENSE` is GNU AGPL v3. Direct incorporation into the NEXORA network
service would carry AGPL corresponding-source obligations. No approval to accept that
licensing obligation has been provided. NEXORA is a JavaScript Cloudflare Worker with D1 and
Mission Runtime; Comail is a Rust/Tauri local desktop client with a loopback listener, SQLite,
and OS keyring. Consequently no Comail code, dependency, or test is copied or imported.

| Area | Comail source / tests | Behavior and security assumption | Compatibility | Classification | NEXORA action / coverage |
|---|---|---|---|---|---|
| Authorization code + PKCE | `src-tauri/crates/comail-core/src/oauth/flow.rs`; no dedicated flow test found | Random state/verifier, S256 challenge, state comparison, local loopback redirect | Loopback desktop flow cannot be a static Worker callback; AGPL direct reuse unapproved | DESIGN_REUSE | Retain NEXORA server-side correlation/state hash and add Worker-specific recovery tests. |
| Google exchange/refresh | `oauth/flow.rs`, `oauth/tokens.rs` | Form grants, offline consent, optional refresh rotation, `invalid_grant` → reauth | Endpoint mechanics compatible; storage/concurrency model is not | DESIGN_REUSE | Keep NEXORA token-exchange/lifecycle service and adapt only normalized error/rotation expectations. |
| Microsoft exchange/scoped tokens | `oauth/providers.rs`, `oauth/flow.rs`, `oauth/tokens.rs` | `/common`, single-resource token caution, scoped refresh for Graph | NEXORA capability scopes differ; Worker must retain tenant/Mission authority | DESIGN_REUSE | Preserve NEXORA tenant-hint and admin-consent runtime; add scoped-token tests where NEXORA requests Graph authority. |
| XOAUTH2 | `oauth/xoauth2.rs`, inline `encodes` test | RFC SASL initial response encoding | NEXORA does not currently use IMAP XOAUTH2 at this boundary | NOT_APPLICABLE | Do not import; retain as future protocol reference only. |
| Provider error normalization | `oauth/tokens.rs` | `invalid_grant` and AADSTS65001 mapped to reauthorization; other errors remain auth failures | Error vocabulary needs NEXORA lifecycle/evidence mapping | DESIGN_REUSE | Use the classification rule without source copying; test revoked vs temporary outcomes. |
| Credential persistence | `accounts/credentials.rs` | OS keyring, Windows chunking, optional insecure test file | Incompatible with Worker/D1 encrypted-secret boundary; insecure-file fallback prohibited | REJECTED_WITH_REASON | Keep NEXORA AES-GCM-at-rest service and D1 generation/fencing boundary. |
| Callback continuation/restart | `oauth/loopback.rs`, `oauth/flow.rs` | In-process loopback waits once; no durable claim/checkpoint recovery | Fundamentally incompatible with stateless Worker/Mission Runtime | REJECTED_WITH_REASON | Implement durable NEXORA claims/checkpoints; no Comail authority may enter the kernel. |
| Token refresh serialization | `oauth/tokens.rs` | In-process mutex and cache; refresh-token rotation persisted to keyring | Not durable across Worker restart and lacks cross-worker fence | REJECTED_WITH_REASON | Use NEXORA D1 claims, leases, fencing, and generation-conditional commits. |

## Imported/adapted tests

No Comail test source is imported because of the license and runtime mismatch. NEXORA will add
equivalent persistence-backed assertions for: PKCE/state rejection, Google/Microsoft grant form
semantics, `invalid_grant` versus temporary error classification, refresh-token rotation, and
XOAUTH2 only if IMAP XOAUTH2 becomes an approved NEXORA provider capability.

## Why NEXORA writes new code

New NEXORA code is required only for tenant/workspace authority, durable callback claims,
checkpoint recovery, Evidence Ledger, Verified Action Boundary, and D1 fencing. Those are absent
from Comail and must remain NEXORA kernel authority. Provider-protocol behavior is informed by
the assessed Comail implementation but not copied.
