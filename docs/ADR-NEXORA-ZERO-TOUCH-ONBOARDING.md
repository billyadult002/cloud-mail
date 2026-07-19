# ADR: NEXORA Zero-Touch Onboarding

Status: Accepted — logic-complete portion implemented and real-D1-tested; provider registration and
production/device acceptance remain external-blocked. Date: 2026-07-18.
Related: `NEXORA_ZERO_TOUCH_ONBOARDING_MANUAL_TOUCH_INVENTORY.md`,
`NEXORA_ZERO_TOUCH_ONBOARDING_LOGIC_COMPLETE_REPORT.md`, `NEXORA_GOOGLE_ADMIN_BOOTSTRAP_PACKAGE.md`,
`NEXORA_MICROSOFT_ADMIN_BOOTSTRAP_PACKAGE.md`, `NEXORA_PROVIDER_ACCEPTANCE_RUNBOOK.md`,
`platform/cloud-mail/mail-worker/src/service/nexora-onboarding-oauth-service.js`.

- **ADR-1 (Zero-Touch definition):** ordinary users perform only provider-required login and consent — no
  OAuth app creation, no client id/secret entry, no host/port/scope configuration, no manual Sync click, no
  manual retry, no manual restart of an interrupted flow. Zero-Touch does not mean bypassing provider
  security, admin policy, or consent; it means NEXORA does everything it is technically able to do and
  converts unavoidable human action into a minimal, resumable checkpoint.
- **ADR-2 (consent as a resumable checkpoint):** every unavoidable human action (login, consent, admin
  approval) is represented as a durable `nexora_onboarding_authorization_sessions` row plus the linked
  `mission_runtime_missions` state, not as in-memory or client-only state — this is what makes "automatic
  continuation after consent" possible even across a process restart.
- **ADR-3 (first-party OAuth app):** a single NEXORA-owned, confidential (server-side) Google/Microsoft OAuth
  application is the default path (`defaultClientType: 'confidential'`). Confidential means the client secret
  is exchanged server-side in the Workers backend and never shipped to desktop/mobile clients.
- **ADR-4 (enterprise BYO-App):** the schema (`client_registration_mode CHECK(... IN ('first_party','byo_app'))`)
  already supports an administrator-scoped bring-your-own-app path; the admin-facing UI/API for BYO-App
  registration is not built in this pass (documented as a follow-on, not silently assumed done).
- **ADR-5 (public vs confidential clients):** both Google and Microsoft adapters use the confidential/Web
  client model, matching the existing server-side token-exchange architecture used elsewhere in this
  codebase; no client secret is ever referenced from the request-construction path
  (`buildAuthorizationUrl`/`createAuthorizationSession` never read `*_CLIENT_SECRET`).
- **ADR-6 (PKCE/state/nonce/replay):** RFC 7636 PKCE (S256) is mandatory for both providers even though
  confidential clients don't strictly require it — defense in depth. `state` is a per-session UUID, hashed
  before storage; a callback must present the original state to be found at all (`INVALID_STATE` otherwise),
  and consumption is a single atomic `UPDATE ... WHERE status='pending'` so a race between two deliveries of
  the same callback cannot double-consume.
- **ADR-7 (durable authorization-session persistence):** sessions live in D1
  (`nexora_onboarding_authorization_sessions`), not KV or in-memory, so `expires_at`/`status` are queryable
  and restart-safe by construction — verified directly (see the "survives being re-read after a simulated
  restart" test).
- **ADR-8 (automatic Mission continuation):** `consumeCallback()` returns a `resumeCheckpoint` string tied to
  the onboarding Mission id; a caller (the not-yet-built callback route) uses this to resume the
  `mission_runtime_missions` state machine via the existing Durable Mission Runtime rather than a new,
  competing resumption mechanism.
- **ADR-9 (minimum scope planning):** `planScopes()` looks up only the scopes a requested capability list
  actually needs (`CAPABILITY_SCOPES`); there is no "request everything up front" path in this codebase.
- **ADR-10 (incremental consent):** `planIncrementalScopes()` computes the set difference against already-
  granted scopes and only requests the delta — verified to never drop previously granted scopes.
- **ADR-11 (Google identity/account binding):** `validateIdentity()` compares the login hint the user started
  with against the provider's returned email; a mismatch is reported as `IDENTITY_CONFLICT`, a precise state,
  not a generic failure.
- **ADR-12 (Microsoft tenant binding):** `validateMicrosoftTenant()` enforces an optional tenant allow-list;
  empty allow-list means "any tenant," matching the multitenant app-registration recommendation in the
  Microsoft bootstrap package.
- **ADR-13 (token storage/refresh/rotation/revocation):** not implemented in this pass — this ADR records the
  *intended* boundary (encrypted storage via the existing `secret-crypto.js` pattern already used for the
  Gmail App Password path, refresh triggered by capability-discovery detecting near-expiry) but the actual
  token-exchange HTTP call and storage code requires a real client_secret to test against and is out of the
  logic-complete scope of this pass — MISSING, not fabricated as done.
- **ADR-14 (capability discovery):** reuses the already-verified `provider-capability-contract-service.js`
  `decide()` function rather than re-implementing decision logic, mapped to the mission's 7-state enum via
  `mapDecisionToCapabilityState()`.
- **ADR-15 (Gmail App Password isolation):** the existing IMAP+App-Password path
  (`gmail-imap-service.js:1258`) is left untouched by this mission — no code change removes or alters it. It
  remains the *only* working Gmail connect path today (OAuth is logic-complete but not yet wired to a UI or
  callback route), so it has NOT been demoted to "advanced compatibility only" yet; that demotion (Required
  Output #23) is explicitly deferred until first-party OAuth is production-verified, per the mission's own
  ordering.
- **ADR-16 (compensation semantics):** `mission_runtime_compensations` + `beginCompensation`/
  `dispatchCompensation`/`observeCompensation`/`verifyAndCompleteCompensation` implement reversal of an
  already-executed action; compensation never edits the original action's evidence (still append-only
  enforced) — it is closed as a prerequisite for enabling any future autonomous write-side onboarding action
  (e.g., an automatic subscription/webhook provisioning step that must be reversible).
- **ADR-17 (compensation authorization/verification):** a compensation can reach `compensated` only via
  `verifyAndCompleteCompensation` after `observeCompensation` — mirrors `finalizeVerifiedOutcome`'s
  executor/verifier separation; a caller cannot skip straight to a final verdict.
- **ADR-18 (provider-acceptance blocking semantics):** missing production credentials block only Checkpoints
  13+ (real provider contact, production/device acceptance) — never blocked logic implementation, matching
  this mission's explicit instruction. `PROVIDER_APPLICATION_MISSING` is the exact, honest state surfaced when
  a session is requested with no configured client_id.
- **ADR-19 (configuration/secret injection):** client IDs/secrets are read from `env.*` at call time only
  (`clientIdEnv` fields), sourced from `wrangler secret put`, never from `wrangler.toml [vars]` or committed
  files — see `NEXORA_ONBOARDING_CONFIG_TEMPLATE.md`.
- **ADR-20 (desktop/mobile redirect strategy):** both providers use a single server-side Web/confidential
  redirect URI; no client secret is embedded in any desktop or mobile client build. Mobile-specific redirect
  handling (deep link back into a native app after the server-side callback) is out of scope for this pass.
- **ADR-21 (Comail reuse):** Comail 0.2.22 was assessed before callback-recovery work; its source is
  AGPL-3.0-only and implements a Rust/Tauri local-client model (loopback listener, keyring, in-process mutex).
  Direct reuse is rejected unless the required network-copyleft obligations are explicitly authorized. Its
  Google/Microsoft grant, error, rotation, and scoped-token mechanics are recorded as design reuse in
  `NEXORA_COMAIL_REUSE_ASSESSMENT.md`; NEXORA retains all Worker/D1/Mission authority and imports no code.
- **ADR-22 (production/desktop/iPhone acceptance):** FULL PASS is explicitly withheld until
  `NEXORA_PROVIDER_ACCEPTANCE_RUNBOOK.md` Steps 4-8 complete with real evidence; this pass ends at
  LOGIC_COMPLETE_PARTIAL.
