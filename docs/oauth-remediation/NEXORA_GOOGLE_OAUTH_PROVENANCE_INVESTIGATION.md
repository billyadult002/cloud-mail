# NEXORA Google OAuth Provenance Investigation

Date: 2026-07-23 (America/Toronto)

Scope: staging only

Branch: `codex/nexora-staging-ucs-trigger-remediation`

Investigated commit: `2038fdd8f84f4c1e467c4aa1e64709fc8c34e70b`

## Final verdict

`VERIFIED_PROVENANCE_READY`

Google-side provenance is established. The authenticated Google Console proves the intended project, Web OAuth client, and registered staging redirect. Cloudflare proves that the three canonical binding names exist as `secret_text`, without disclosing their values. This satisfies the provenance-readiness checkpoint and removes the prior Google project visibility blocker.

Exact live Cloudflare binding equality remains a deliberate next-stage runtime check, not a reason to read secret values or expand Google authority. The active staging Worker predates the redacted provenance endpoint in commit `2038fdd`; after separately authorized staging deployment, that endpoint can correlate SHA-256 client/redirect fingerprints with the Google-side records. No OAuth flow, Gmail API access, credential creation, or Provider Connection is required.

## Evidence inventory

| ID | Source | Redacted observation | Establishes | Does not establish |
|---|---|---|---|---|
| G-01 | Authenticated Google Cloud Console | Project ID `nexora-503322`, displayed project name `nexora` | Google project identity and current console visibility | Cloudflare binding contents |
| G-02 | Google Auth Platform client list/detail | One listed OAuth client; application type `Web application`; client ID `151318451585-6lfu68126phbtudkg773eu0bmtv1t549.apps.googleusercontent.com`; last used Jul 23, 2026 | Intended Google OAuth client identity, type, and use metadata | The value currently stored in Cloudflare |
| G-03 | Google OAuth client detail | Registered redirect `https://cloud-mail-staging.fastonegroup.workers.dev/v3/onboarding/providers/google/callback` | Exact Google-side staging redirect registration | The value currently stored in Cloudflare |
| G-04 | Google OAuth client detail | Two enabled client secrets were reported; values were neither revealed nor copied | A confidential Web-client configuration exists | Secret value, equality, or fitness |
| CF-01 | `wrangler secret list --env staging` | `NEXORA_GOOGLE_OAUTH_CLIENT_ID`, `NEXORA_GOOGLE_OAUTH_CLIENT_SECRET`, and `NEXORA_GOOGLE_OAUTH_REDIRECT_URI` exist as `secret_text` | Canonical staging binding names and types exist | Any binding value |
| CF-02 | `wrangler deployments status --env staging --json` | Active version `83c0b7a8-cc21-4324-91ff-b4640ca9bd39`, deployment `f687c54c-5563-4089-a918-50d21a309d65`, 100% traffic | Observed staging runtime identity | Deployment of commit `2038fdd` |
| CF-03 | Remote D1 SELECT-only probes | Users, workspaces, OAuth sessions, credential refs, Provider Connections, and Connections all equal zero; `rows_written=0`, `changed_db=false`; foreign-key check empty | Environment remained unactivated and unchanged | OAuth configuration equality |
| CF-04 | Remote migration list | `0086_nexora_staging_authority_tuple.sql` is pending | Authority Tuple schema was not applied | Future migration result |
| R-01 | `nexora-onboarding-oauth-service.js` | Google launch consumes `NEXORA_GOOGLE_OAUTH_CLIENT_ID` and `NEXORA_GOOGLE_OAUTH_REDIRECT_URI` | Canonical runtime configuration contract | Live values |
| R-02 | `nexora-onboarding-token-exchange-service.js` | Confidential exchange uses `NEXORA_GOOGLE_OAUTH_CLIENT_SECRET` only when token exchange is invoked | Secret-use boundary | Secret value or live exchange |
| R-03 | `nexora-staging-authority-tuple-service.js` | `oauthProvenance()` returns client/redirect SHA-256 fingerprints and redirect origin/path; it does not inspect the client secret | Safe correlation mechanism is implemented | Live correlation before deployment |
| R-04 | `init-api.js` | `/init/authority-tuple/oauth-provenance` is registered in source | Route exists in commit `2038fdd` | Route exists in active staging Worker |
| C-01 | Comail compatibility records | OAuth/PKCE concepts only; no source, assets, dependencies, or client provenance reused | No hidden Comail configuration dependency | NEXORA staging client provenance |

## Correlation findings

### Google project and client

Authenticated console access resolved the prior Google visibility gap. The displayed project is `nexora-503322`, and its only listed OAuth client is a Web application matching the intended NEXORA client. The exact client ID is public OAuth configuration, not a client secret.

For non-value correlation, the client ID fingerprint is:

`69f804fa7e15a07048dbead70d6aee545fd6b6835cb363622e64ee080739c3a8`

### Redirect URI

The Google client contains the exact canonical staging callback:

`https://cloud-mail-staging.fastonegroup.workers.dev/v3/onboarding/providers/google/callback`

Its SHA-256 fingerprint is:

`2932c176d2f3f5986775ebbfa44c065373d36db4defa0fdc1f7adda80a2f0e5b`

This independently proves Google-side registration. It does not prove that Cloudflare's write-only binding currently contains the same URI.

### Cloudflare bindings

Cloudflare metadata proves presence and type for all three canonical bindings. Because secret values are write-only and this mission forbids reading them, binding-name presence cannot be promoted to value equality. No secret value, masked suffix, token, or credential material is recorded in this report.

### Worker and deployment

Commit `2038fdd` implements a separately gated, redacted runtime diagnostic. It reads only the client ID and redirect URI, emits their fingerprints plus parsed redirect origin/path, and explicitly reports the secret binding as not inspected. The observed active Worker version predates this commit; therefore repository tests and source inspection are deployment preparation, not live-runtime proof.

## Exhausted evidence paths

- Repository history and configuration references were searched for the exact client ID and canonical environment names.
- Worker source, staging configuration, route registration, and deployment metadata were inspected.
- Cloudflare secret inventory was read without retrieving values.
- Authenticated Google Console project, client-list, client-detail, redirect, type, and usage metadata were inspected without modifications.
- Remote D1 was inspected with SELECT-only queries.
- Comail records were evaluated and rejected as a source of NEXORA-specific provenance.
- The reviewed redacted diagnostic was evaluated but cannot produce live evidence until deployed.

No additional read-only evidence path can prove the write-only Cloudflare values. Exact end-to-end equality therefore belongs to the next controlled staging deployment and fingerprint-correlation stage; it is not behind missing Google Console visibility and does not require Google authority expansion.

## Boundary and environment verification

- No Google OAuth client or redirect was changed.
- No secret value was read, revealed, copied, logged, or rotated.
- No Google authorization flow or Gmail API call was initiated.
- No OAuth Session, Credential Reference, Provider credential, Provider Connection, or Connection was created.
- Bootstrap was not reactivated.
- Migration `0086` was not applied.
- No Worker deployment occurred.
- Production was not inspected or modified.
- Remote database probes reported `rows_written=0` and `changed_db=false`.

## Minimum next canonical action

Under a separately authorized staging deployment mission, deploy commit `2038fdd` or a reviewed descendant, invoke the separately scoped redacted provenance endpoint, and compare only:

1. client ID SHA-256 fingerprint;
2. redirect URI SHA-256 fingerprint;
3. redirect origin and path.

The client secret must remain uninspected. A match would close the remaining live-runtime correlation gap while preserving the current `VERIFIED_PROVENANCE_READY` Google provenance verdict.
