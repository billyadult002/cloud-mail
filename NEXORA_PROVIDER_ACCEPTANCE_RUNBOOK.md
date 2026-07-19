# NEXORA Zero-Touch Provider Acceptance Runbook

Execute this immediately after real Google and/or Microsoft OAuth applications exist (per the admin bootstrap
packages) and their credentials are injected via `wrangler secret put`. No architecture or code redesign is
required — this runbook only exercises what is already logic-complete and committed.

## Prerequisites checklist

- [ ] Google: OAuth consent screen configured, redirect URI registered, `Gmail API` enabled, secrets injected.
- [ ] Microsoft: App registration configured, redirect URI registered, secrets injected.
- [ ] `wrangler secret list` confirms both `NEXORA_*_OAUTH_CLIENT_ID` are present (values not printed).
- [ ] `NEXORA_GOOGLE_OAUTH_REDIRECT_URI` and `NEXORA_MICROSOFT_OAUTH_REDIRECT_URI` match their registered
      provider redirect URI byte-for-byte; the existing provider callback routes forward the authorization
      code and configured redirect URI into the Mission Runtime token-exchange path.

## Step 1 — Logic regression (must pass before touching a real provider)

```bash
cd platform/cloud-mail/mail-worker
npx vitest run scripts/reliability-tests
```
Expect: all test files pass, including `nexora-onboarding-oauth.test.mjs` (19 tests) and
`nexora-mission-runtime-pool-workers.test.mjs` (17 tests). Any failure here means do not proceed to a real
provider — the guarantees this runbook relies on (PKCE correctness, replay/duplicate/expiry safety) are
exactly what those tests prove.

## Step 2 — Secret presence and scope guard

```bash
wrangler secret list | grep -E "NEXORA_(GOOGLE|MICROSOFT)_OAUTH_CLIENT_ID"
git log -p -3 -- platform/cloud-mail/mail-worker/src/service/nexora-onboarding-oauth-service.js | grep -iE "client_secret\s*=|access_token\s*=" && echo "FAIL: secret literal found" || echo "clean"
```

## Step 3 — Single synthetic canary session (still no real provider contact)

Confirm `createAuthorizationSession()` now returns `ok:true` with a real `authorizationUrl` once the client_id
env vars are set (this was previously `PROVIDER_APPLICATION_MISSING` by design — see
`nexora-onboarding-oauth.test.mjs`'s `E9/V5` test). This is a config-presence check, not a provider call.

## Step 4 — One real, human-authenticated test-user onboarding (Google)

Using a Google account added as a test user (see the Google bootstrap package §7):
1. Trigger onboarding via `POST /v3/onboarding/start` → provider login/consent →
   `/v3/onboarding/providers/google/callback`.
2. Confirm: identity validated (`validateIdentity`), granted scopes match the minimum-scope plan exactly
   (`validateGrantedScopes` — no extra scopes silently granted), capability discovery reports `SUPPORTED` for
   `mail_read`, and the originating Mission automatically resumes (no user action needed post-consent).
3. Record: authorization_session_id, callback_fingerprint, identity result, granted scopes, capability
   result, timestamps — into the Evidence Ledger via the existing `mission_runtime_evidence` table, keyed to
   the onboarding mission.
4. This step alone is what upgrades the verdict from LOGIC_COMPLETE_PARTIAL toward
   GOOGLE_PROVIDER_VERIFIED — logic tests alone never do.

## Step 5 — One real, human-authenticated test-user onboarding (Microsoft)

Same as Step 4, substituting a real Microsoft account and the Microsoft callback route. Additionally confirm
`validateMicrosoftTenant()` behaves correctly against the real returned `tid` claim.

## Step 6 — Refresh-behavior observation (both providers)

Force a token near-expiry (or wait for natural expiry) and confirm an automatic refresh succeeds without user
interaction, using the real provider's token endpoint — this is real-provider evidence that
`nexora-onboarding-oauth.test.mjs`'s deterministic fixtures cannot substitute for.

## Step 7 — Revoked-consent repair observation (pick one provider)

Manually revoke the app's grant (Google: `myaccount.google.com/permissions`; Microsoft:
`myaccount.microsoft.com/organizations`) for the test account, then confirm the next capability-discovery or
refresh attempt surfaces `CONSENT_REQUIRED` (not a generic error) and that re-triggering onboarding produces a
new, correct, minimal-scope authorization session — not a broader re-request.

## Step 8 — Desktop + real iPhone acceptance (only after Steps 4-7 pass for the relevant provider)

Authenticated desktop: complete the full onboarding journey in a real desktop browser session against
production, screenshot + network-log evidence correlated to the same `authorization_session_id` recorded in
Step 4/5.

Real iPhone: same journey on a physical iPhone (not a simulator) against production. Per this mission's own
boundary, this step requires the user's own physical device and presence — it cannot be executed
autonomously.

## Step 9 — Final verdict

Only after Steps 1-8 (for each provider you're accepting) complete with recorded evidence may the Mission
report `FULL PASS` for that provider. Partial completion (e.g. Google accepted, Microsoft still blocked on
admin registration) is reported as `GOOGLE_PROVIDER_VERIFIED / MICROSOFT_BLOCKED`, never rounded up.
