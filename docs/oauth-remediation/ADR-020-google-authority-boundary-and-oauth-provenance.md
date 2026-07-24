# ADR-020: Google Authority Boundary and OAuth Provenance Resolution

Date: 2026-07-24

Status: Accepted for staging provenance readiness

## Context

NEXORA staging was blocked because the system could not independently prove the Google OAuth Web Client backing the Cloudflare staging bindings. Cloudflare Worker secrets are intentionally opaque and must not be read, copied, logged, reset, or disclosed. Google Console is the authority for OAuth client type and redirect registration.

## Decision

Treat authenticated Google Console read-only evidence as the Google-side authority for OAuth client metadata, and treat Cloudflare `secret_text` binding inventory as the Cloudflare-side binding-presence authority. Do not attempt to read secret values. Exact runtime equality between the opaque Cloudflare binding and the Google client is proven only through a deployed redacted Worker diagnostic that returns fingerprints and parsed redirect metadata.

The current Google-side evidence establishes:

- project: `nexora-503322`;
- OAuth client type: Web application;
- OAuth client ID: `151318451585-6lfu68126phbtudkg773eu0bmtv1t549.apps.googleusercontent.com`;
- registered staging redirect URI: `https://cloud-mail-staging.fastonegroup.workers.dev/v3/onboarding/providers/google/callback`;
- usage signal: last used on 2026-07-23.

The current Cloudflare-side evidence establishes:

- `NEXORA_GOOGLE_OAUTH_CLIENT_ID` exists as `secret_text`;
- `NEXORA_GOOGLE_OAUTH_CLIENT_SECRET` exists as `secret_text`;
- `NEXORA_GOOGLE_OAUTH_REDIRECT_URI` exists as `secret_text`;
- no secret value was read.

## Rejected assumptions

- Secret names alone prove exact client ID equality: rejected.
- Repository fixtures or tests prove live Google OAuth Client provenance: rejected.
- Google Console visibility is still the blocker: rejected after authenticated read-only evidence established the Web client and redirect.
- Reading or printing Cloudflare secret values is an acceptable proof path: rejected.

## Consequences

The provenance checkpoint verdict is `VERIFIED_PROVENANCE_READY`.

The next canonical staging step is not Google authority expansion. It is controlled staging deployment of the reviewed commit and invocation of the verifier-gated `/init/authority-tuple/oauth-provenance` route to produce redacted live fingerprints for equality correlation. That step must still avoid OAuth session creation, Gmail API calls, provider credential creation, provider connection creation, and production mutation.
