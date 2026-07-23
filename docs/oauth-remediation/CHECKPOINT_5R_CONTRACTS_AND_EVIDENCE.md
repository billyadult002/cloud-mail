# Checkpoint 5R Contracts and Evidence

## Preserved stop and containment record

Read-only production inspection before implementation confirmed the Connection remained
`AUTHORIZATION_PENDING`, generation 8, with provider/credential/session generations zero.
There were no verified callback results, Provider Connections, credentials, health calls,
mailbox mutations, refresh jobs, sync dispatches, watches, or delta operations. Automatic
refresh remained disabled. No OAuth session, callback replay, code replay, token exchange,
Gmail call, or provider write was initiated by this remediation.

The two exposed callback attempts are classified non-replayable and excluded from future
acceptance. Their evidence is limited to existing redacted session/Connection/callback
fingerprints and checkpoint counts. The observed provider response may represent a live
grant; because CloudMail has no committed credential reference and Google offers no
credential-free exchange-result reconciliation, any revocation requires a separately
authorized, precisely scoped plan. Codex Gmail/Drive/Calendar connectors must not be used
for inspection or revocation.

## Root-cause and sink inventory

The prior GET handler parsed the query and returned JSON on the same callback URL.
Consequently the full provider URL could remain in the address bar, browser history,
ambient tab state, screenshots, and any referrer from that page. The success-only cookie
clear left rejection and exception paths exposed. The orchestrator recorded
`TOKEN_EXCHANGE_RESPONSE_OBSERVED` and then performed session lookup, lease renewal,
JWKS/ID-token verification, identity/tenant checks, encryption, token persistence,
capability discovery, Provider Connection creation, Evidence, Verification, and Connection
binding. A crash in that interval consumed the code but left no recoverable provider result.

Source paths:

- `mail-worker/src/api/nexora-onboarding-api.js`
- `mail-worker/src/service/nexora-onboarding-orchestrator-service.js`
- `mail-worker/src/service/nexora-onboarding-callback-recovery-service.js`
- `mail-worker/src/service/nexora-onboarding-token-exchange-service.js`
- `mail-worker/src/service/nexora-onboarding-token-storage-service.js`

Before remediation, query data was not intentionally written to Evidence or Verification,
but the browser/JSON surface and exception path made downstream screenshots, reports, and
ambient tooling unsafe. Normal application logs do not log callback fields; the new route
also catches all callback exceptions before framework error rendering.

## Revised callback contract

Input is provider GET query plus HttpOnly PKCE cookie. Server output is always `303` to
`/v3/onboarding/providers/{provider}/result`, with no query/fragment and with cookie
invalidation, no-store, no-referrer, and restrictive CSP. The clean result page is static
and resource-free. Callback values never enter client state or response bodies. Before
redirecting, the route performs only state/PKCE consumption plus an encrypted, two-minute
intake/job commit. Provider exchange and all later work run behind the durable intake
consumer. Worker platform observability is disabled in `wrangler.toml` so callback query
strings are not retained by source-configured Worker invocation logs; application
OAuth-boundary modules contain no normal console logging. This is pre-deployment evidence
only. The deployed Worker setting and any separate HTTP, Logpush, security, or account-level
datasets remain a disabled-deployment verification gate and are not claimed as live-clean.

## Revised authorization-session contract

The immutable session row retains hashed state, nonce, verifier, redirect identity, scope
plan, tenant/workspace/provider, expiry, and single-use status. The additive
`nexora_oauth_authorization_session_bindings` sidecar binds the session to Connection,
Connection generation, authority generation, account plus its current owner, exact
membership/delegation authority references and generations when delegated, Domain
Authority ID and generation, exact redirect hash, OAuth client fingerprint, manifest
version/digest, issue/expiry, callback receipt, exchange, and recovery status. The
Connection fields are filled only by the existing Connection Runtime after its verified
authorization transition. A durable `runtime_mode` discriminator preserves the disabled-
Connection-Runtime path: `LEGACY` requires a wholly null Connection/authority tuple,
while `CONNECTION_RUNTIME` requires the full live-authority relation. The real migration
SQLite proof exercises both modes.

## Exchange receipt and recovery contract

One attempt exists per session and correlation. It is owned by the canonical callback
claim, lease, and fence. D1 stores no raw code/query/verifier/token columns. The receipt is
short-lived AES-GCM ciphertext with tuple-bound AAD. A successful response is durably
distinguished before identity and credential work. Recovery decrypts locally, resumes
under a current fence, and makes zero provider exchange calls. Stale fences, wrong scope,
tampering, expiry, duplicate promotion, and terminal reopening fail closed.

Migration 0084 also installs tuple and transition triggers: session/correlation/claim/
binding mismatches are rejected; terminal states cannot reopen; and
`CALLBACK_VERIFIED` requires canonical verified callback, token-binding, and Provider
Connection lineage. The first token insert and attempt-state promotion are one D1 batch.
Failure-injection tests after receipt seal, credential commit, and Provider Connection
commit prove one provider exchange, credential generation one, and ciphertext tombstoning
after recovery through the same scheduled intake path used by production. `INSERT OR
IGNORE` losers never inherit exchange ownership, stale intake workers cannot complete a
newer fence, expired unsealed attempts become `REAUTHORIZATION_REQUIRED` with an ambiguous
outcome classification, and live Connection/authority predicates are repeated inside the
credential/provider commit path and at the verified-result schema boundary. A reusable
D1 live-authority view rechecks the non-deleted canonical Account, Workspace membership,
exact active/unexpired delegation and membership generations, delegated read scope, and
verified/non-revoked Domain Authority generation. Account deletion, delegation
revocation, and Domain Authority revocation/generation advance all reject without relying
on a cached Connection-row mutation; the exchange rejection occurs before provider-call
authority, while later token and verified-result writes abort atomically.
Provider-response sealing repeats the predicate in one rollback-safe batch, so in-flight
revocation writes no ciphertext, checkpoint, or recoverable status. The final transition
to `CONNECTED` additionally requires the exact
`CONNECTION_COMMITTED_VERIFICATION_PENDING` attempt, canonical verified result,
Credential Reference/generation, and Provider Connection/generation.

An isolated local system-Chrome run confirms the HTTP redirect replaces the callback
document with the fixed result route: final URL has no query or fragment, back navigation
returns to the pre-callback page, `document.referrer` is empty, the performance navigation
entry is queryless, no subresources load, and the rendered HTML contains no callback
fixture sentinel. Response headers are `private, no-store, max-age=0`, `no-referrer`, and
`default-src 'none'` CSP. This is local browser proof, not production browser/log proof.

## Plugin isolation

CloudMail resolves OAuth clients from Worker environment bindings and credentials from
`nexora_onboarding_tokens` through the Connection Runtime. It contains no connector API,
Codex credential store path, Gmail connector ID, Drive connector ID, or Calendar connector
ID. Connector tools cannot resolve D1 Credential References or callback claims. Connector
installation and calls are not represented in CloudMail Connection events, Evidence,
Verification, Provider call counts, or acceptance. The plugins were not read, modified,
removed, or invoked during remediation.

## Comail provenance and reuse decision

- Authorization: mission-approved public repository `NextOSP/comail`
- Inspected revision: commit `d068e09bc0511213754964f2e0a6ab9481121663`,
  branch `master`, release `v0.2.25`
- License: AGPL-3.0
- Inspected paths: `src-tauri/crates/comail-core/src/oauth/flow.rs`,
  `src-tauri/crates/comail-core/src/oauth/tokens.rs`, and core queue/retry references
- Direct reuse: rejected. It is a Rust desktop localhost-loopback flow with OS keyring and
  in-memory access-token caching; it has no D1 multi-tenant callback claim/fence or sealed
  post-exchange recovery transaction. Direct copying would introduce architecture,
  dependency, and AGPL obligations inappropriate for this Worker.
- Adaptation: concepts only. Retain short access-token residency, durable refresh-token
  protection, and explicit reauthentication classification.
- Fixture/test reuse: rejected; desktop loopback fixtures do not exercise Worker browser
  redirects, D1 atomic batches, tenant scope, or Connection generations.
- Destination: independently implemented Worker services and tests in this remediation;
  no Comail source copied and no new dependency or notice obligation introduced.

## Migration and rollback

Migration 0084 is additive and repeatable because it uses only `CREATE TABLE/INDEX/TRIGGER
IF NOT EXISTS`. It adds authorization-session bindings, encrypted callback intakes,
encrypted exchange attempts, indexes, and integrity/transition triggers. It does not
mutate generation 8, existing sessions, tokens, connections, or production data and was
not applied to production. Rollback is operational: leave both processing flags disabled,
leave the sidecars unused, and keep OAuth session creation/callback acceptance disabled.
Destructive table removal is not part of rollback.

## Local verification evidence

- Focused OAuth security and orchestrator matrix: 48/48.
- Full Worker release regression: 22 files, 267/267.
- Unit, syntax, OAuth SQLite repeatability, artifact, Provider-coupling, and
  Connection-coupling checks: pass.
- Clean installation was performed with the frozen lockfile; `npm audit --audit-level=low`
  reports zero vulnerabilities.
- Changed-diff credential signature scan: pass; no real secrets were used in fixtures.
- Reviewed Worker source commit: `bf416af9850c45a5d756d93319aaa9f302078d78`.
- Evidence commit: `4ee66faf3eb854b0c284d915cc12934e77ce070c` on PR #10.
- Production dry-run bundle for that exact source: 2430.93 KiB, gzip 520.12 KiB;
  no deployment occurred.
- Independent checker and OAuth security reviewer: PASS, no unresolved P0/P1/P2.

## Future retry gate

Any retry requires a separate human-approved mission for exactly one new session. It must
name the reviewed commit/deployment/migration, confirm the manifest digest, keep session
lifetime at ten minutes or less, complete consent within the bounded window, and stop on
query exposure, expiry, scope drift, ambiguous exchange, possible second provider call,
lease/fence loss, or any credential/Connection/Evidence/Verification mismatch. Previous
sessions and callbacks remain prohibited.

Current readiness inputs are source commit
`bf416af9850c45a5d756d93319aaa9f302078d78`, migration 0084 authored and locally
repeatable but **not applied**, and deployment **not performed**. A future approval cannot
use this report as deployment evidence; it must first bind the exact deployed Worker
version and applied migration status, then independently inspect the redacted scope
summary before the one allowed consent action.

The disabled deployment sequence keeps `NEXORA_OAUTH_AUTHORIZATION_CREATION_ENABLED=false`,
`NEXORA_CONNECTION_RUNTIME_ENABLED=false`, and
`NEXORA_OAUTH_CALLBACK_PROCESSING_ENABLED=false`. Authorization creation is default-off in
the API. Only after reviewed migration/schema proof and exact-source deployment may a
separately approved bounded retry enable authorization creation and callback processing
for that attempt. Production observability/Logpush configuration must also be inspected
with redaction before that retry.
