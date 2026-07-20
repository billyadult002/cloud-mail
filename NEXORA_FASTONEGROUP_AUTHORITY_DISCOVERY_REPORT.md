# NEXORA Fastonegroup Domain Ownership and Workspace Authority Discovery

Date: 2026-07-19 (America/Toronto)

Mode: production read-only discovery

Domain candidate: `fastonegroup.com`
Verdict: `BLOCKED_PRECONDITIONS_NOT_MET`

## Executive decision

Activation must not resume. The candidate domain is hosted on Cloudflare and the user-authorized Chrome session proves that its DNS records are editable, but production evidence does not identify a unique NEXORA workspace or an authenticated admin-to-workspace lineage. Required correlation bindings and build allowlists are absent.

No migration, deployment, DNS mutation, bootstrap, classification, evidence population, direct D1 write, or verdict upgrade was performed. Successful production queries reported `changes=0`, `rows_written=0`, and `changed_db=false`.

## Evidence summary

| Chain | Read-only evidence | Decision |
| --- | --- | --- |
| Workspace | Two workspaces; one OWNER membership in each; both have historical bindings to accounts in the candidate domain. Six domain accounts are bound to more than one workspace and 29 are unbound. | No unique target workspace can be inferred. `BLOCKED`. |
| Domain binding | `workspace_domains` has zero rows for the candidate domain. | No production workspace binding. |
| Ownership | No ownership challenge, verified domain, or domain authority row exists for the candidate domain. `_nexora-domain` has no TXT answer. | No recoverable ownership chain. |
| Admin authority | Production `admin` and `jwt_secret` bindings are present by name. The code requires authenticated actor email equality, actor-derived tenant, and actor membership. No authenticated NEXORA admin session was available. | Structural path `PASS`; actor-specific lineage `BLOCKED`. |
| DNS authority | Authoritative nameservers are Cloudflare. In the user-authorized, signed-in Chrome session, the candidate-domain DNS Records page exposes enabled `Add record` and existing-record `Edit` controls. | TXT publication authority `PASS`; no record was created or changed. |
| Runtime identity | Production Worker version is `733708e6-c07b-41f9-90e1-d4caa1562f7f`; `CF_VERSION_METADATA`, NEXORA runtime deployment/release bindings are absent. | Server correlation identity unavailable. |
| Correlation secret | `NEXORA_CORRELATION_HASH_SECRET` is absent. `SESSION_SECRET` is also absent. | `BLOCKED`. |
| Build allowlists | `NEXORA_ACCEPTANCE_BUILDS_JSON` is absent; no Desktop or physical-iPhone build is allowlisted. | `BLOCKED`. |
| Browser surfaces | Both signed-in tabs show FASTONE Hermes/V24 at the production and local URLs. | Login exists, but this is not a NEXORA/CloudMail admin authority signal. |

## Workspace and membership evidence

- Production workspaces: 2.
- Production membership rows: 2.
- Role distribution: both memberships are `OWNER`, one per workspace.
- Both workspace creators have an OWNER membership in their own workspace; there is one distinct creator across the two workspaces.
- Candidate-domain accounts: 37.
- Candidate workspaces derived from historical account bindings: 2.
- Accounts bound across multiple workspaces: 6.
- Candidate-domain accounts with no workspace binding: 29.
- No `workspace_domains` record exists for the candidate domain.

Historical account bindings, majority counts, workspace ordering, or the configured domain list are not authority. The target must be selected through an authenticated actor-scoped workspace path and revalidated server-side.

## Domain and DNS evidence

- Apex NS/SOA establish Cloudflare as the authoritative DNS provider.
- Existing apex TXT records are unrelated to NEXORA and cannot be reused as ownership proof.
- `_nexora-domain.fastonegroup.com` currently has no TXT answer.
- Wrangler OAuth proves read access only. Separately, the user-authorized Chrome session proves interactive DNS edit authority for the candidate zone: the exact zone records page loaded under the signed-in account and exposed enabled `Add record` and `Edit` controls.
- Zero matching rows exist in workspace-domain, ownership-challenge, and domain-authority production records.

The absence of an existing binding removes an existing-record collision, but it does not grant either workspace ownership.

## Admin authority evidence

The product path is correctly designed to require all of the following:

1. an authenticated actor;
2. actor email equal to the configured admin identity;
3. tenant derived from the authenticated actor, never from request-body authority;
4. actor membership in the requested workspace.

Only aggregate membership and binding-name presence were observable. Without an authenticated NEXORA admin request and server readback, the admin actor cannot be linked to the single creator/OWNER or either target workspace.

## Configuration evidence

The following production bindings were confirmed absent by name-only inspection:

- `CF_VERSION_METADATA`
- `NEXORA_CORRELATION_HASH_SECRET`
- `NEXORA_ACCEPTANCE_BUILDS_JSON`
- `NEXORA_RUNTIME_DEPLOYMENT_ID`
- `NEXORA_RUNTIME_RELEASE_ID`

Accordingly, Desktop and physical-iPhone acceptance sessions cannot produce the required fail-closed server correlation evidence.

## FASTONE surface boundary

`https://v12.fastonegroup.com/` returns HTTPS 200 and the signed-in page identifies itself as FASTONE Hermes/V24. The local page at `http://127.0.0.1:8765/` presents the same product. Repository policy explicitly separates FASTONE V23/V24, Hermes, and the v12 surface from NEXORA. Their login, reviewer identity, workspace state, HTTP status, tunnel, or screenshots must not be treated as NEXORA workspace authority, admin authentication, DNS ownership, or correlation evidence.

## ADR decisions

### Domain discovery decision

Retain `fastonegroup.com` as the candidate domain. Treat it as unverified until a new product-generated challenge is published and verified through the authenticated NEXORA workflow.

### Workspace selection decision

Do not select either workspace from historical account data. Require authenticated actor-scoped enumeration, explicit user selection, and server-side OWNER/ADMIN membership validation.

### Admin authority validation

The authorization model is structurally valid, but production actor lineage is unproven. Browser login to FASTONE does not satisfy this requirement.

### DNS authority validation

Cloudflare hosting and interactive TXT publication authority are confirmed through the user-authorized Chrome session. The user's authorization in this task is evidence of the operator decision, but the current read-only Mission still prohibits creating the TXT record. A later Activation Mission must separately authorize the actual challenge and DNS mutation sequence.

### Correlation configuration validation

Fail closed. Do not start Desktop/iPhone acceptance until immutable deployment metadata, a dedicated correlation secret, and exact signed-build allowlists are present.

## Security review

- No sensitive values were read or recorded.
- No token, cookie, secret, DNS credential, raw TXT challenge, or device identifier is present in this report.
- UI login, HTTP 200/401, account counts, code tests, and deployment existence were rejected as substitutes for authority evidence.
- The active design still requires security closure or explicit risk acceptance for short non-cryptographic DNS fingerprints and correlation hashing that is not a dedicated HMAC construction.

## Readiness gate

Activation may resume only after all items below have production evidence:

1. authenticated NEXORA admin identity readback;
2. explicit target workspace selection plus OWNER/ADMIN membership proof;
3. DNS owner/operator confirmation with TXT publication authority — **satisfied by the signed-in Chrome authority check**;
4. `CF_VERSION_METADATA` runtime binding;
5. dedicated `NEXORA_CORRELATION_HASH_SECRET`;
6. exact Desktop and physical-iPhone build allowlist entries;
7. resolved project-boundary guard inconsistency;
8. separately authorized migration/deployment and activation execution.

## Final status

- Project: `IMPLEMENTED_DEPLOYED_ACTIVATION_BLOCKED`
- Overall: `LOGIC_COMPLETE_PARTIAL`
- Device: `PARTIAL_REAL_DEVICE_PASS_SERVER_CORRELATION_PENDING`
- Discovery: `AUTHORITY_DISCOVERY_PARTIAL_BLOCKED`

The requested target `ACTIVATION_READY_AWAITING_WORKSPACE_AND_ADMIN_AUTHORITY_CONFIRMATION` is not reached. DNS authority is now confirmed, but target workspace/admin lineage, correlation configuration, and build allowlists remain blocked or absent.
