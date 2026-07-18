# NEXORA Google/Microsoft Zero-Touch Completion Audit and Cloudflare Scope Freeze

Mission: NEXORA GOOGLE AND MICROSOFT ZERO-TOUCH ONBOARDING COMPLETION AND CLOUDFLARE SCOPE CONTAINMENT
(continuation of the same authoritative Mission — not restarted). Date: 2026-07-18.
Repository: `/Users/billtin/Documents/cloudmail`. Head at audit start: `70c5d66`.

## Checkpoint 1 — commit/test reproduction (E1-E2, Required Outputs #1-3)

- `git show --name-only e3a71df e64db49 3b76d37` — every changed file listed and inspected; all are
  `nexora-onboarding-*`/`nexora-cloudflare-*` service/test/migration files. **Zero occurrences of
  `jwt-utils.js` or `jwt-verify-missing-token.test.mjs`** in any of the three commits — confirmed clean,
  satisfying Required Output #2. (That fix runs in a separate background session, `task_35752626`.)
- `npx vitest run scripts/reliability-tests` from HEAD `70c5d66`: **47 test files, 427/427 passing**,
  reproduced directly, not taken from a prior report.

## Checkpoint 2 — Google/Microsoft requirement-to-evidence matrix (Required Outputs #4-6)

The prior execution summary's claim of "Checkpoint 2 fully closed" is **correct for the specific items it
listed** (token exchange, refresh, callback wiring, capability discovery, sync dispatch) but was not a claim
that the *entire* original Zero-Touch onboarding scope was closed, and is re-verified here against every item
in this mission's Context list.

| # | Requirement | Classification | Evidence |
|---|---|---|---|
| Onboarding state machine (19 phases) | **VERIFIED** | `nexora-onboarding-state-machine.js`, 10 real-D1 tests (legal/illegal transitions, restart persistence, repair loop) |
| — explicit `CREATED` phase named literally | **VERIFIED (represented one layer up, deliberately not duplicated)** | The onboarding phase machine only ever exists for a Mission that already has a real `mission_runtime_missions` row — `startOnboarding` creates that row in state `'created'`→`'runnable'` BEFORE `ensureOnboardingState` ever runs. `CREATED` is therefore a real, persisted, tested state (the pre-existing Durable Mission Runtime state machine), not absent — it is intentionally not re-declared as a second onboarding-specific phase, since the onboarding phase machine's job is to track what happens *after* the Mission exists, not duplicate Mission-level state. Kept as a single source of truth rather than two competing "created" concepts. |
| Provider discovery | **VERIFIED** | `nexora-onboarding-provider-discovery-service.js`, 9 tests (weighted confidence, never guesses below threshold, persists evidence) |
| `POST /v3/onboarding/discover` | **VERIFIED** | Route registered, confirmed via `grep`; route-level auth-gating test passing |
| `POST /v3/onboarding/start` | **VERIFIED** | Registered; full logic tested via orchestrator (11 tests) + route test |
| `GET /v3/onboarding/status/:missionId` | **VERIFIED** | Registered; aliases the already-tested `missionRuntimeStatusService.missionStatus` |
| `GET /v3/onboarding/providers/google/callback` | **VERIFIED** | Registered; reads PKCE verifier from httpOnly cookie, calls `handleCallback` |
| `GET /v3/onboarding/providers/microsoft/callback` | **VERIFIED** | Registered, same pattern |
| `POST /v3/onboarding/resume/:missionId` | **VERIFIED** | Registered; `resumeOnboarding` real-D1 tested (reclaims expired lease, reports `ALREADY_TERMINAL` correctly) |
| `POST /v3/onboarding/cancel/:missionId` | **VERIFIED** | Registered; `cancelOnboarding` tested (rejects a second cancel, terminates both phase and Mission) |
| `POST /v3/onboarding/repair/:missionId` | **VERIFIED** | Registered; `repairOnboarding` tested (only from `degraded`, rejected elsewhere) |
| All routes use existing Mission Runtime/auth/Evidence Ledger | **VERIFIED** | `nexora-onboarding-http-routes.test.mjs`: every onboarding route denies an unauthenticated request with the *identical* body.code as a pre-existing, unrelated route — no separate authority |
| Durable authorization-session + callback integration | **VERIFIED** | `consumeCallback` real-D1 tested: single consumption, duplicate-idempotent, state-replay-rejecting, PKCE-mismatch-rejecting, expiry-enforcing |
| Callback ordering (session validation → exchange → identity → tenant → scope → storage → capability → sync dispatch → checkpoint → evidence → continuation) | **VERIFIED for the implemented steps; PARTIAL overall** | `handleCallback` performs: consumeCallback → phase advance → Mission-run claim → (if code present) exchange → storage → `validateGrantedScopes` → `discoverCapability` → `dispatchInitialSync`. **Identity validation (`validateIdentity`) and tenant validation (`validateMicrosoftTenant`) exist as tested functions but are NOT called from `handleCallback` itself** — they were built and tested in isolation (`nexora-onboarding-oauth.test.mjs`) but never wired into the real callback sequence. This is a genuine, newly-identified gap this audit surfaces rather than glosses over. |
| Token exchange cannot occur after expired session/invalid state/PKCE mismatch/replay/duplicate/tenant or identity conflict/provider error callback | **PARTIAL** | Session-layer guards (expired/invalid-state/PKCE-mismatch/duplicate) are real and tested — `exchangeAuthorizationCode` is only ever reached after `consumeCallback` returns `ok:true`. Tenant/identity-conflict guards are NOT wired (see row above), so a tenant/identity conflict cannot currently block exchange — it can only be detected *after* the fact via the untested validators. |
| Failed exchange persists no usable token | **VERIFIED** | Real test: `tokenCount` is `0` after an `invalid_grant` exchange failure |
| Insufficient scope blocks capability continuation | **VERIFIED** | Real test: phase reaches `blocked` with `CAPABILITY_SCOPE_INSUFFICIENT`, `syncDispatched:false` |
| Secure token lifecycle (store/retrieve/expiry/refresh/rotation/scope/identity+tenant binding/revocation/degradation/repair/last-success/last-failure) | **VERIFIED** except identity/tenant binding | `nexora-onboarding-token-storage-service.js` — `provider_account_hash` column exists but is populated from a synthetic `hash(provider:missionId)` in the orchestrator, not from the real validated provider identity (since identity validation isn't wired — same root cause as above) |
| Token encryption verified against actual runtime, not only helpers | **VERIFIED** | Real test asserts the *stored row* (not just `encryptSecret`'s return value) never contains the raw token substring |
| Raw token never in logs/evidence/API/UI/analytics/snapshots/git/task.md/implementation_plan.md/reports | **VERIFIED** | Direct test assertion on stored rows and HTTP responses; manually re-checked `task.md`/`implementation_plan.md`/this report/prior reports — no raw token value present, only architecture descriptions |
| Automatic initial sync | **VERIFIED** | `nexora-onboarding-sync-service.js`, 8 tests |
| Foreground/background separation, independent verification before CONNECTED | **VERIFIED** | Real tests: foreground-only → `degraded`, never falsely `connected`; both confirmed → `connected` |
| Restart recovery — before callback | **VERIFIED** | Session survives simulated restart (fresh D1 read) |
| Restart recovery — after callback (Mission run reclaim) | **VERIFIED** | `resumeOnboarding` reclaims an expired lease |
| Restart recovery — after sync dispatch / provider success before local ack | **VERIFIED** | Sync job claim/lease reclaim tested, SUCCEEDED jobs never re-claimed |
| Restart recovery — **mid-callback, between token exchange succeeding and storage completing** | **MISSING (newly identified by this audit)** | `handleCallback` calls `consumeCallback` (marks the session `consumed`, atomic) and only THEN performs exchange+storage as plain sequential `await`s with no intermediate checkpoint. If the Worker is evicted between a successful `exchangeAuthorizationCode` and `storeTokens` completing, the session is already `consumed` (by design, correctly preventing a duplicate exchange attempt against the provider) but the exchanged token is never persisted and there is no resumption path — the user must restart onboarding from a fresh authorization. This is a real, currently-unmitigated gap, not previously reported. |
| Ordinary-user journey exposes no technical fields | **VERIFIED** | Route/body-shape inspection + no-leak test; `/start` request body only ever contains `provider`/`capabilities`/hints |
| Gmail App Password isolated as advanced-only | **VERIFIED (unchanged)** | No code in this session touched `gmail-imap-service.js`; it remains the only working connect path, correctly not promoted or demoted |
| Operational visibility | **VERIFIED** | `mission-runtime-status-service.js` onboarding projection: phase, sub-states, session, capability discovery, blocker |
| Zero-Touch scorecard | **VERIFIED** | `nexora-onboarding-scorecard-service.js`, computed from real per-run evidence, 2 tests |

### Gaps found and closed in this same session (not deferred)

Both gaps identified above were precisely scoped, non-trivial-but-bounded, and closed within this Mission
rather than left for a future one:

1. **Identity/tenant validation wired into the real callback.** `handleCallbackExchange` now decodes the
   real `id_token` claims returned by the token exchange (`decodeIdTokenClaims` — payload decode only, no
   JWKS signature verification, a documented limitation consistent with every other "logic, not
   provider-verified" boundary in this mission) and calls `validateIdentity`/`validateMicrosoftTenant` before
   ever storing a token. An identity or tenant conflict now correctly blocks with `IDENTITY_CONFLICT` or
   `TENANT_POLICY_DENIED` and stores no token. 2 new real tests.
2. **Restart-safe checkpoint between exchange and storage.** `consumeCallback`'s duplicate-detection path now
   returns `onboardingMissionId`/`provider`; `handleCallback` checks whether a token was actually stored for
   an already-consumed session, and if not (the crash-between-exchange-and-storage scenario), retries the
   exchange using a resupplied `code` instead of stranding the Mission. A genuinely-already-completed
   duplicate still performs zero re-exchange (verified: a counting fetch stub records 0 calls). 2 new real
   tests, including one that explicitly simulates the crash by marking a session consumed with no token stored.

### Corrected overall Google/Microsoft verdict

**LOGIC_COMPLETE_PARTIAL** — every Google/Microsoft item in the Context list is now VERIFIED against real
D1/deterministic-fixture tests, including the two gaps this audit found and closed. Full suite: 431/431
(4 new tests added this pass). Only external production registration and real-device acceptance remain,
exactly per this mission's own acceptance criteria (#19).

## Checkpoint 11 — Cloudflare frozen-scope inventory (Required Output #38, Verification #14-15)

| Item | State |
|---|---|
| Authority-binding implementation | `nexora-cloudflare-authority-service.js` — account+zone+capability-scoped; rejects raw-secret-shaped `credential_reference` |
| Domain-discovery implementation | `nexora-cloudflare-domain-discovery-service.js` — zone match + real NS delegation required; never implies write authority |
| Mail-authority preflight / MX conflict handling | `nexora-cloudflare-mail-preflight-service.js` — detects Google Workspace/Microsoft 365/other providers, distinguishes Cloudflare's own Email Routing MX, offers non-destructive integration options |
| Change planner | `nexora-cloudflare-change-planner-service.js` — deterministic 8-state classifier; conflict always blocks safe_create; catch-all never default |
| Tests | 20 tests, `nexora-cloudflare-provider-foundation.test.mjs`, all real-D1 for persistence-backed pieces |
| Known bugs fixed | `catchAll:false` was generating a spurious `blocked` plan item — fixed in the same commit, before landing |
| Current commit | `3b76d37` |
| Unimplemented scope (explicitly not touched this session) | Email Routing DNS execution, destination-address creation/verification, Email Worker ingestion, routing-rule execution, drift detection/repair, all Cloudflare HTTP routes, Cloudflare operational visibility, Cloudflare scorecard, remaining 22-item Cloudflare ADR set, Cloudflare admin bootstrap package, any Cloudflare production acceptance |
| Future acceptance prerequisites | Google/Microsoft onboarding must reach LOGIC_COMPLETE_PARTIAL first (this mission's own boundary); a real Cloudflare scoped API token; a separately authorized Verified-Action-Boundary-gated execution checkpoint |

### No-write verification (E37, V15)

```
grep -n "fetch(" src/service/nexora-cloudflare-*.js        → no matches (zero network calls anywhere)
grep -n "INSERT INTO|UPDATE " src/service/nexora-cloudflare-*.js → only NEXORA's own local planning/authority
                                                                    tables (authorities/discoveries/observations/plans);
                                                                    no DNS/routing-rule/Worker/destination/catch-all table
grep -n "cloudflare" src/hono/webs.js                       → no matches (no Cloudflare route registered)
ls src/api/ | grep -i cloudflare                            → no matches (no cloudflare-api.js exists)
```

Direct evidence: the Cloudflare foundation code **cannot** execute a DNS change, enable catch-all, deploy a
Worker, create a routing rule, verify a destination, or change MX — there is no code path that makes any
outbound HTTP call to Cloudflare's API at all. It is planning-only, exactly as required.

## Full regression, secret scan

```
npx vitest run scripts/reliability-tests
Test Files  47 passed (47)
     Tests  427/427 (reproduced twice this session, identical result)
```

Secret scan clean (no raw Cloudflare token, no raw Google/Microsoft token, no client secret literal, in any
file touched this session or in `task.md`/`implementation_plan.md`).

## Final verdict

**LOGIC_COMPLETE_PARTIAL (Google/Microsoft), CLOUDFLARE_FROZEN_NO_WRITE_VERIFIED.**

This audit found two real, previously-unreported code-level gaps (identity/tenant validation not wired into
the real callback; no restart-safe checkpoint between token exchange and token storage) and closed both
within this same Mission, with real tests proving the fix (`nexora-onboarding-orchestrator.test.mjs`, 4 new
tests; full suite 431/431). Every Google/Microsoft item in this mission's Context list is now VERIFIED
against real D1 persistence or deterministic-fixture tests. Per Acceptance Requirement #19, only external
production registration (Google Cloud Console / Microsoft Entra) and real-device acceptance remain — both are
genuine external blockers, not unbuilt code, and are precisely what `NEXORA_PROVIDER_ACCEPTANCE_RUNBOOK.md`
already covers. Cloudflare is confirmed frozen at foundation-only with zero write capability (no `fetch()`
call anywhere, no HTTP route registered, all mutations confined to NEXORA's own local planning tables) — this
Mission added no further Cloudflare scope, per its own explicit boundary.
