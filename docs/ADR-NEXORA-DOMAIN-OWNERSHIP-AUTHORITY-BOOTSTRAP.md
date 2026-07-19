# ADR: NEXORA Domain Ownership Validation And Authority Bootstrap

Date: 2026-07-19

Status: Accepted

## Context

NEXORA's Evidence-First classification runtime is deployed, and `classifyAndPersist()` correctly requires a verified `nexora_domain_authorities` row before it can persist classification and Evidence rows. Production currently has zero `nexora_domain_authorities` rows, zero verified `workspace_domains` rows, zero `nexora_email_classifications` rows, and zero `nexora_email_classification_evidence` rows.

The missing piece is not the classifier. The missing piece is a server-authoritative Domain Ownership Validation flow that can promote a domain from an arbitrary customer-owned domain into a verified workspace authority without trusting an administrator's declaration alone.

## Decision

Domain Authority Bootstrap must be a promotion step, not an ownership-proof step.

NEXORA will separate the chain into three durable boundaries:

1. Domain Ownership Validation:
   A workspace may submit any syntactically valid domain for validation. The server issues an idempotent verification challenge or records an external provider/zone proof. Acceptable root proofs are DNS TXT challenge verification, Cloudflare zone ownership/control evidence, Google Workspace/Microsoft tenant or admin-consent evidence where the provider cryptographically binds the tenant/domain, or an already verified `workspace_domains` authority state produced by those mechanisms.

2. Verified Domain Authority Bootstrap:
   An authenticated admin may promote only a previously verified workspace-domain ownership record into `nexora_domain_authorities`. The bootstrap step must bind `tenant_id`, `workspace_id`, `normalized_domain`, `administrator_authority_ref`, `verification_method`, `verification_evidence_ref`, and `generation`.

3. Classification Runtime Activation:
   `classifyAndPersist()` remains unchanged in principle: it may persist classification and Evidence rows only after it finds a verified, non-revoked `nexora_domain_authorities` row for the tenant/workspace/domain tuple.

## Domain Ownership Model

Root ownership evidence:

- `DNS_TXT_CHALLENGE`: server-generated token under a NEXORA-controlled challenge name.
- `CLOUDFLARE_ZONE_CONTROL`: zone identity and account authority verified through a provider API using least-privilege credentials.
- `GOOGLE_WORKSPACE_ADMIN`: Google identity/admin-consent or domain metadata that binds the authenticated tenant to the domain.
- `MICROSOFT_TENANT_ADMIN`: Microsoft tenant/admin-consent or verified domain metadata that binds the authenticated tenant to the domain.
- `VERIFIED_WORKSPACE_DOMAIN`: an existing `workspace_domains` row whose `authority_state` is verified by one of the above mechanisms.

Supplemental evidence only:

- Mailbox authorization.
- Workspace account bindings.
- Cached email aggregates.
- Provider account sync health.
- Admin assertion.
- UI screenshot evidence.

Supplemental evidence may improve the audit trail, but it cannot create domain-wide authority by itself. This prevents public mailbox domains such as consumer email domains from being promoted to enterprise authority merely because cached mail exists.

## Bootstrap Responsibility Boundary

The bootstrap endpoint is responsible for:

- Requiring an authenticated admin session.
- Requiring tenant/workspace membership linkage.
- Reading verified workspace-domain ownership evidence.
- Creating or updating exactly one `nexora_domain_authorities` row per `(tenant_id, workspace_id, normalized_domain)`.
- Writing redacted audit evidence.
- Returning bodyless authority metadata only.

The bootstrap endpoint is not responsible for:

- Proving ownership from scratch.
- Trusting a raw admin-submitted domain.
- Writing classification rows.
- Writing classification Evidence rows.
- Bypassing `classifyAndPersist()`.

## Runtime Activation Decision

`classifyAndPersist()` remains the only row-generating classification path. The correct activation sequence is:

1. Validate domain ownership into `workspace_domains.authority_state=VERIFIED` or equivalent verified state.
2. Bootstrap the verified domain into `nexora_domain_authorities`.
3. Execute `/v3/classification/persist` with authenticated admin authority and an approved bodyless real-message input.
4. Verify `nexora_email_classifications > 0`.
5. Verify `nexora_email_classification_evidence > 0`.
6. Retrieve the generated row and evidence by tenant/workspace/domain/fingerprint.

## Evidence Requirements

The Evidence package must include:

- Domain validation method and evidence reference.
- Tenant/workspace/member linkage.
- Verified workspace-domain state before bootstrap.
- Bootstrap request identity and admin authority reference.
- `nexora_domain_authorities` row after bootstrap.
- Audit rows for bootstrap.
- Classification row after runtime execution.
- Classification Evidence row after runtime execution.
- Retrieval proof.

No raw OAuth state, authorization code, provider token, PKCE verifier, session cookie, raw provider payload, private signing material, email body, or unrelated personal data may be persisted in the Evidence package.

## Current Production Finding

Read-only production verification on 2026-07-19 found:

- `nexora_domain_authorities = 0`.
- Verified `workspace_domains = 0`.
- `workspace_domains = 0`.
- `cloudmail_domains = 0`.
- `workspace_provider_grants = 0`.
- `mailbox_authorizations = 6`.
- `nexora_email_classifications = 0`.
- `nexora_email_classification_evidence = 0`.
- D1 metadata reported `changed_db=false`.

`mailbox_authorizations` are mailbox-level delegation evidence only. They are not accepted as domain-wide ownership evidence.

## Candidate Implementation Note

A local, un-deployed candidate endpoint has been staged on branch `codex/nexora-domain-authority-bootstrap`:

- `mail-worker/src/api/nexora-domain-authority-api.js`.
- `mail-worker/src/service/nexora-domain-authority-bootstrap-service.mjs`.
- `mail-worker/scripts/domain-authority-bootstrap-contract-check.mjs`.

The candidate endpoint is admin-only, binds tenant and workspace through `workspace_members`, requires verified `workspace_domains` authority state, writes only `nexora_domain_authorities` plus redacted audit rows, and rejects mailbox/account/email aggregates as root evidence.

This candidate is not production acceptance evidence until reviewed, merged, deployed, and executed against real verified ownership evidence.

## Consequences

The current verdict cannot advance to `FULL_PASS`. The correct next Mission is Domain Ownership Validation implementation: create the server-issued challenge and provider-backed ownership proof path that can set `workspace_domains.authority_state=VERIFIED` with auditable Evidence. Only then may bootstrap and classification persistence produce production business Evidence.
