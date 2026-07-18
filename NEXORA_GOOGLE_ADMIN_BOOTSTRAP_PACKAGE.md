# NEXORA Google OAuth Administrator Bootstrap Package

This is the one-time, administrator-only registration the Zero-Touch onboarding mission cannot perform
itself — it requires your own Google Cloud Console access. Everything below is executable immediately after
you complete it, with no further code or architecture changes.

## 1. Application type

**Web application** (confidential client) — NEXORA is a Cloudflare Workers backend that exchanges the
authorization code server-side. Do **not** create a "Desktop app" or "Android/iOS" client type; those are
public clients and would force a PKCE-only, secretless flow that doesn't match the current server-side
exchange design (`nexora-onboarding-oauth-service.js`, `defaultClientType: 'confidential'`).

## 2. Authorized redirect URIs

Register exactly (production + any staging you intend to verify against):

```
https://<your-production-domain>/v3/onboarding/callback/google
https://<your-staging-domain>/v3/onboarding/callback/google
```

(No callback route is wired yet — Checkpoint 4 of a follow-on mission adds `/v3/onboarding/callback/google`.
Register the URI now so it's stable when that route ships.)

## 3. Required APIs to enable (Google Cloud Console → APIs & Services → Library)

- **Gmail API** — required for `mail_read`/`mail_send` capabilities.
- **Google People API** — only if a future capability needs contacts (not requested by the current minimum-
  scope plan; do not enable pre-emptively).

## 4. Minimum initial scopes (from `CAPABILITY_SCOPES.google` in the onboarding service)

```
openid
email
https://www.googleapis.com/auth/gmail.readonly
```

## 5. Incremental scopes (requested only when a later Mission needs them)

```
https://www.googleapis.com/auth/gmail.send        (only if/when a send capability is enabled)
https://www.googleapis.com/auth/calendar.readonly (only if/when calendar capability is enabled)
```

## 6. OAuth consent screen requirements

- **User type**: External (unless every intended user is inside your own Workspace, in which case Internal
  is stricter and simpler).
- **App name / logo**: use the NEXORA branding assets already in the repo (`nexora logo/`), not "CloudMail".
- **Scopes**: add exactly the minimum-initial-scopes list above at this step; do not add `gmail.send` or
  `calendar.readonly` until those capabilities are actually implemented and requested.
- **Sensitive scope justification**: `gmail.readonly` is a sensitive scope — Google requires a written
  justification and, for External apps requesting sensitive scopes, a security assessment before general
  availability (see Publishing requirements below).

## 7. Test-user requirements (while the app is in "Testing" publishing status)

Add each real Google account you'll use for production provider verification (Checkpoint 14) as a test user
under OAuth consent screen → Test users. Test-mode apps work identically for those accounts without requiring
Google's verification review — this is sufficient for Checkpoint 14/19 acceptance before full publishing.

## 8. Publishing requirements (only if you need *any* Google user, not just test users, to connect)

- Submit for verification once you exceed 100 test users or want general availability.
- Sensitive-scope apps (which `gmail.readonly` is) require Google's OAuth verification + a CASA security
  assessment. Budget real calendar time for this — it is not a same-day process.
- Until verified, only test users can complete the flow; NEXORA's onboarding should surface this honestly as
  `ADMIN_APPROVAL_REQUIRED`/publishing-pending, not a generic failure.

## 9. Credential storage destination

Store the **Client ID** and **Client Secret** as Cloudflare Workers secrets (`wrangler secret put`), bound to
the exact env var names the onboarding service already reads:

```
wrangler secret put NEXORA_GOOGLE_OAUTH_CLIENT_ID
wrangler secret put NEXORA_GOOGLE_OAUTH_CLIENT_SECRET
```

Never place these in `wrangler.toml` `[vars]` (plaintext, committed) or in any repo file. See
`NEXORA_ONBOARDING_CONFIG_TEMPLATE.md` for the placeholder-only template.

## 10. Rotation procedure

1. In Google Cloud Console, create a second OAuth client secret for the same client (Google allows 2 active
   secrets concurrently).
2. `wrangler secret put NEXORA_GOOGLE_OAUTH_CLIENT_SECRET` with the new value.
3. Deploy.
4. Confirm new authorization sessions succeed (a synthetic/canary onboarding, not a real user).
5. Delete the old secret in Google Cloud Console.

## 11. Revocation procedure

- **Revoke one user's grant**: the user can do this themselves at `myaccount.google.com/permissions`, or an
  admin can revoke it via Google Workspace Admin Console (Workspace accounts only). NEXORA's
  `validateGrantedScopes`/capability-discovery path will surface this as `CONSENT_REQUIRED` on the next token
  refresh attempt, not a silent failure.
- **Revoke the entire application**: delete the OAuth client in Google Cloud Console. All outstanding refresh
  tokens become invalid immediately; every connected account surfaces `CONSENT_REQUIRED` on next refresh.

## 12. Production validation commands (run immediately after credentials are injected)

```bash
# Confirm the secret is bound (does not print the value)
wrangler secret list | grep NEXORA_GOOGLE_OAUTH_CLIENT_ID

# Confirm the redirect URI is reachable (once the callback route ships)
curl -s -o /dev/null -w "%{http_code}\n" https://<your-domain>/v3/onboarding/callback/google
```

Then run the pool-workers OAuth test suite once more (`npx vitest run scripts/reliability-tests/nexora-onboarding-oauth.test.mjs`)
to confirm no regression, followed by a single real, human-authenticated test-user onboarding attempt
(Checkpoint 14) as the actual production acceptance evidence — not the automated test suite, which only
proves logic.

## 13. Rollback procedure

`wrangler secret delete NEXORA_GOOGLE_OAUTH_CLIENT_ID` / `NEXORA_GOOGLE_OAUTH_CLIENT_SECRET` immediately
reverts session creation to the honest `PROVIDER_APPLICATION_MISSING` state (already tested — see
`nexora-onboarding-oauth.test.mjs`) with zero code changes needed. No user's already-connected account is
affected by this rollback (existing refresh tokens keep working against Google until you also revoke the
client itself).
