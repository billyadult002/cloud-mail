# NEXORA Zero-Touch Onboarding — Manual-Touch Inventory (Checkpoint 2)

Mission: NEXORA ZERO-TOUCH PROVIDER ONBOARDING AND AUTONOMOUS CONTINUATION. Date: 2026-07-18.
Scope: read-only inspection of the existing CloudMail/NEXORA onboarding, OAuth, and provider-connect surface.
No code changed in this pass.

## Finding: there is no OAuth authorization-code flow for mail providers at all

`grep -rl "code_verifier|authorization_code|PKCE|redirect_uri" src/` matches only two files, neither of
which is a mail provider:
- `oauth-service.js` — a **third-party login provider** ("linuxDo"), unrelated to mailbox connection.
- `gemini-oauth-service.js` — OAuth for the **Gemini AI provider** (drafting/summarization), not mail.

There is **no Microsoft/Entra/Outlook code path at all** — `grep -rli "microsoft|entra|outlook.office|graph.microsoft"`
only matches label/text strings in `provider-runtime-config-loader.js` (an unrelated AI-provider config
loader) and `nexora-v3-service.js` (planning/matrix text). No working Microsoft mail integration exists.

## Current Gmail connect flow: IMAP + Google App Password (`gmail-imap-service.js:1258`)

`POST /gmail/connect` → `gmailImapService.connect(c, userId, {email, appPassword})`:
1. Requires `email` to end in `@gmail.com`/`@googlemail.com` — **no other Google Workspace domain path**.
2. Requires `appPassword` (Google App Password, ≥12 chars) — the user must:
   - Have 2-Step Verification already enabled on their Google account (external Google prerequisite).
   - Manually navigate to `myaccount.google.com/apppasswords`.
   - Manually generate a 16-character app password.
   - Manually copy and paste it into CloudMail.
3. Directly opens a raw IMAP socket (`cloudflare:sockets`) and issues `SELECT INBOX` as the connectivity check.
4. On success, encrypts the app password (`encryptSecret`) and stores it in `mail_provider_credentials`.

**This is not OAuth at all.** It technically satisfies "no client id/secret exposed to the user" (Verification
Requirements #1/#2 are accidentally already true), but it fails nearly everything else Zero-Touch requires:
scope minimization (an app password is all-or-nothing IMAP access, not a scoped grant), incremental consent
(impossible — no scopes exist), revocation detection (must poll IMAP auth failures, no push signal), and
identity/tenant verification (no OpenID token, no verified Google identity — just "IMAP login succeeded").

## Manual-touch inventory (Evidence Requirement #1/#2)

| # | Manual step | Who | Eliminable by OAuth? |
|---|---|---|---|
| 1 | Enable 2-Step Verification on Google account (if not already) | User | Not directly — but OAuth consent doesn't *require* 2SV the way app passwords do |
| 2 | Navigate to Google App Passwords settings | User | Yes — replaced by an OAuth consent redirect |
| 3 | Generate a 16-char app password | User | Yes |
| 4 | Copy the app password | User | Yes |
| 5 | Paste it into CloudMail's connect form | User | Yes — replaced by "Continue with Google" |
| 6 | Manually retry on any IMAP auth failure (no automatic repair path found) | User | Yes — Zero-Touch requires automatic repair |
| 7 | No Microsoft/Outlook path exists — a Microsoft user cannot onboard at all today | User (blocked entirely) | N/A — must be built from scratch |
| 8 | No Google Workspace (non-gmail.com domain) path exists | User (blocked entirely) | N/A — must be built from scratch |

## What already exists and is reusable as-is

- Encrypted credential storage pattern (`encryptSecret`/`decryptSecret` via `secret-crypto.js`) — reusable for
  OAuth refresh tokens once real OAuth exists.
- `account` table + `sync_status` state machine (`sync_required` etc.) — a real, working sync-state model that
  a Zero-Touch onboarding flow can hook into rather than replace.
- `provider-capability-contract-service.js`'s `decide()` function (from the NEXORA kernel audit, already
  VERIFIED) — its capability-decision states (`supported`/`unsupported`/`needs_reconnect`/
  `authorization_missing`/`approval_required`/`authorization_stale`/`temporarily_unavailable`) already cover
  most of Required Output #12's target state set. It is provider-neutral and can likely be reused directly
  rather than rebuilt for onboarding capability discovery.
- The Durable Mission Runtime (same audit) already has the state-machine, lease/fencing, evidence, and
  verified-action-boundary primitives a Zero-Touch Onboarding Mission needs — it should be the *foundation*
  for the Onboarding Mission contract (Required Output #1), not a parallel implementation.
- `mission-runtime-status-service.js` (this session, NEXORA kernel audit) — the operational-visibility pattern
  it establishes is directly reusable for Required Output #16.

## The hard blocker for Checkpoints 4 and beyond

Required Output #5 ("a first-party NEXORA OAuth application path... so ordinary users do not create or paste
provider client credentials") requires a **real registered Google Cloud OAuth consent screen** and/or
**Microsoft Entra app registration**, each producing a `client_id` (and, for a confidential/server-side flow,
a `client_secret`) that only the account/organization owner can create — this is not something achievable from
inside this repository or session. This is a genuine "unavailable required credentials or authorization" stop
condition per this mission's own rules, not a routine confirmation request:

- I cannot create a Google Cloud project, configure an OAuth consent screen, or register redirect URIs — that
  requires the user's own Google Cloud Console access.
- I cannot create a Microsoft Entra app registration — that requires the user's own Microsoft admin access.
- Building the PKCE/authorization-code flow *code* without any real client_id to test against would produce
  code that has never actually completed a real OAuth handshake — exactly what the mission's boundaries
  forbid presenting as done ("Do not claim Zero-Touch PASS from mocked providers, local-only callbacks... or
  token exchange success").

## What I can safely do next without those credentials (does not require the blocker to resolve)

1. Design and implement the **provider-neutral onboarding capability contract** (Required Output #4) and the
   **onboarding state machine** (Required Output #2) as pure functions + a migration, following the exact
   pattern already validated for the Durable Mission Runtime — this is pure logic/schema work, testable with
   pool-workers today, and doesn't need a live provider.
2. Design the **Zero-Touch Onboarding Mission contract** (Required Output #1) as an extension of the existing
   `mission_runtime_*` tables rather than a new parallel schema.
3. Wire the OAuth client id/secret **references** (env var names only, e.g. `GOOGLE_OAUTH_CLIENT_ID`,
   `MICROSOFT_OAUTH_CLIENT_ID`) using the same absent-until-configured pattern already used throughout this
   repo (`ai_authorization/AI_AUTHORIZATION_METHODS.json`, `provider-runtime-config-loader.js`'s
   `referenceEnv`/`secretEnv` fields) — present in code, empty/unconfigured until the user supplies real
   values, feature-flagged off by default.
4. Build and test the PKCE/state/callback-correlation **logic** (code_verifier generation, state-token
   binding, replay protection) against synthetic/local-only exchanges, explicitly labeled as logic-only
   verification (mirroring the "pool-workers benchmark proves logic, not remote timing" distinction already
   established in this session) — never claimed as a completed real-provider connection.

## Audit answers (for this Checkpoint 2 pass)

- What did NEXORA complete automatically in the CURRENT flow? Nothing OAuth-related — current flow is
  entirely manual (app password paste).
- What unavoidable action requires a person right now? Registering the first-party OAuth application itself
  (Google Cloud / Microsoft Entra), which only the product owner (the user) can do.
- Was any technical setup exposed to an ordinary user today? Yes — an app password, which is itself a manual
  technical step even though it isn't a "client secret."
- Did any secret enter logs/evidence/UI? Not inspected in this pass beyond the encryption call site; the app
  password is passed as a request body field and encrypted before storage — no further redaction audit done.
- Final verdict for Checkpoint 2: **COMPLETE** (inventory produced, real evidence, no fabrication).
- Final verdict for Checkpoints 4+: **BLOCKED (external)** — requires the user to register a real Google
  Cloud OAuth consent screen and/or Microsoft Entra application before any first-party OAuth code can be
  meaningfully built and verified, per this mission's own boundary against claiming success from untested
  provider code.
