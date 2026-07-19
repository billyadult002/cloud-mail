# NEXORA Microsoft OAuth Administrator Bootstrap Package

One-time, administrator-only registration in Microsoft Entra ID (formerly Azure AD) — requires your own
Microsoft admin access. Executable immediately after completion, no further code changes needed.

## 1. Supported account types

**"Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal
Microsoft accounts (e.g. Skype, Xbox)"** — this is the broadest option and is what lets both Microsoft 365
enterprise users and personal Outlook.com/Hotmail users onboard through the same app registration
(`PROVIDERS.microsoft` in the onboarding service uses `/common` by default, or a per-tenant endpoint when a
durable `tenant_hint` exists, which this account type supports).

If your organization's policy requires restricting to a single tenant, choose "Accounts in this organizational
directory only (Single tenant)" instead — `validateMicrosoftTenant()` already enforces an `allowedTenantIds`
policy independent of this Azure setting, so both choices are compatible with the current code.

## 2. Redirect URIs

Under Authentication → Platform → **Web** (not "Public client/native" — see client-type decision below):

```
https://cloud-mail.fastonegroup.workers.dev/v3/onboarding/providers/microsoft/callback
```

## 3. Public versus confidential client decision

**Confidential (Web) client**, matching Google's decision above and the existing server-side exchange
architecture. Do not enable "Allow public client flows." A client secret (or, preferably, a certificate
credential — Entra supports both) is required and must live only in Cloudflare Workers secrets, never in the
app registration's exposed configuration or any client-side code.

## 4. Required delegated permissions (Microsoft Graph, minimum initial)

```
openid
profile
email
Mail.Read
```

(Matches `CAPABILITY_SCOPES.microsoft` in the onboarding service — `identity` + `mail_read`.)

## 5. Incremental permissions (requested only when a later Mission needs them)

```
Mail.Send      (only if/when a send capability is enabled)
Calendars.Read (only if/when calendar capability is enabled)
```

## 6. Administrator-consent requirements

- `Mail.Read`/`Mail.Send`/`Calendars.Read` are **delegated** permissions (act as the signed-in user), which
  do **not** require tenant-admin consent by default — an individual user can consent for themselves. This is
  a real Zero-Touch advantage over Google's sensitive-scope verification burden.
- However, many enterprise tenants configure a policy requiring admin consent for *any* third-party app
  regardless of permission type. NEXORA's onboarding must treat a consent failure here as
  `ADMIN_APPROVAL_REQUIRED` (already a defined capability-discovery state) and produce the exact admin-consent
  URL:
  ```
  https://login.microsoftonline.com/{tenant-id}/adminconsent?client_id={client-id}&redirect_uri={redirect_uri}
  ```
  NEXORA stores this as the durable `waiting_for_admin_consent` checkpoint. When the original authorization
  session used a `tenant_hint`, the same tenant value is used for token exchange and the administrator-consent
  URL so runtime evidence remains tenant-correlated.

## 7. Tenant restrictions

If your organization requires restricting which Microsoft tenants may connect (e.g. only your own tenant, or
an explicit partner allow-list), configure `allowedTenantIds` in the deployment's onboarding policy — enforced
by `validateMicrosoftTenant()` (already real-tested, see `nexora-onboarding-oauth.test.mjs`). Leaving the list
empty means any tenant (or personal account) may connect, appropriate for the default multitenant registration
above.

## 8. Credential/certificate storage destination

```
wrangler secret put NEXORA_MICROSOFT_OAUTH_CLIENT_ID
wrangler secret put NEXORA_MICROSOFT_OAUTH_CLIENT_SECRET
wrangler secret put NEXORA_MICROSOFT_OAUTH_REDIRECT_URI
```

Prefer a certificate credential over a client secret in Entra if your organization's security policy requires
it (Entra supports uploading a public key and using a signed JWT client assertion instead of a shared secret)
— this is a token-exchange-time detail outside this contract-construction module's scope, and does not change
anything in `nexora-onboarding-oauth-service.js`.

## 9. Rotation procedure

1. In Entra ID → App registrations → your app → Certificates & secrets, add a new client secret (Entra
   supports multiple concurrent secrets with independent expiry dates — set a 6 or 12-month expiry, never
   "Never expires").
2. `wrangler secret put NEXORA_MICROSOFT_OAUTH_CLIENT_SECRET` with the new value.
3. Deploy.
4. Confirm new sessions succeed.
5. Delete the old secret in Entra.

## 10. Revocation procedure

- **Revoke one user's grant**: user self-service at `myaccount.microsoft.com/organizations`, or a tenant admin
  via Entra ID → Enterprise applications → your app → Users and groups → remove, or via Graph API.
- **Revoke the entire application**: delete the app registration or disable it in Entra. All tokens become
  invalid; `CONSENT_REQUIRED` surfaces on next refresh for every connected account.

## 11. Production validation commands

```bash
wrangler secret list | grep NEXORA_MICROSOFT_OAUTH_CLIENT_ID
curl -s -o /dev/null -w "%{http_code}\n" https://cloud-mail.fastonegroup.workers.dev/v3/onboarding/providers/microsoft/callback
```

Then re-run `npx vitest run scripts/reliability-tests/nexora-onboarding-oauth.test.mjs`, followed by one real,
human-authenticated onboarding attempt with a real Microsoft account (Checkpoint 15) as the actual acceptance
evidence.

## 12. Rollback procedure

`wrangler secret delete NEXORA_MICROSOFT_OAUTH_CLIENT_ID` / `NEXORA_MICROSOFT_OAUTH_CLIENT_SECRET` reverts to
the honest `PROVIDER_APPLICATION_MISSING` state with zero code changes, without affecting already-connected
Google accounts (independent client_id namespace) or any existing Microsoft account's Entra-side grant.
Add a staging URI only after its deployed origin is recorded in the deployment evidence.
