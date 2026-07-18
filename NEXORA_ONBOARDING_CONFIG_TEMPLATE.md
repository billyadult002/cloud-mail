# NEXORA Zero-Touch Onboarding — Configuration Template (placeholders only)

No real value appears in this file or anywhere in source control. Every value below is injected through
Cloudflare Workers secrets (`wrangler secret put`) or, for non-secret config, `wrangler.toml [vars]`.

## Secrets (never in `wrangler.toml`, never committed)

| Env var | Set via | Placeholder |
|---|---|---|
| `NEXORA_GOOGLE_OAUTH_CLIENT_ID` | `wrangler secret put` | `<GOOGLE_CLOUD_CONSOLE_OAUTH_CLIENT_ID>` |
| `NEXORA_GOOGLE_OAUTH_CLIENT_SECRET` | `wrangler secret put` | `<GOOGLE_CLOUD_CONSOLE_OAUTH_CLIENT_SECRET>` |
| `NEXORA_MICROSOFT_OAUTH_CLIENT_ID` | `wrangler secret put` | `<ENTRA_APP_REGISTRATION_CLIENT_ID>` |
| `NEXORA_MICROSOFT_OAUTH_CLIENT_SECRET` | `wrangler secret put` | `<ENTRA_APP_REGISTRATION_CLIENT_SECRET_OR_CERT_THUMBPRINT>` |

## Non-secret config (may live in `wrangler.toml [vars]` once real values exist)

| Var | Purpose | Placeholder |
|---|---|---|
| `NEXORA_ONBOARDING_REDIRECT_BASE_URL` | Base URL the callback routes are registered under | `<https://your-production-domain>` |
| `NEXORA_MICROSOFT_ALLOWED_TENANT_IDS` | Comma-separated allow-list for `validateMicrosoftTenant()`; empty = any tenant | `<tenant-id-1,tenant-id-2>` (or leave unset) |

## Verification that the template contains no real values

```bash
grep -E "AIza|ya29\.|client_secret.*=.*[A-Za-z0-9]{20,}" NEXORA_ONBOARDING_CONFIG_TEMPLATE.md || echo clean
```

Run this before every commit that touches onboarding config docs.
