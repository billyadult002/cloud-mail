# NEXORA authorization map

## Previous failure

`beginOnboarding` discarded every request grant (correctly, because app input is
untrusted), then persisted the resulting `AUTHORIZATION_REQUIRED` model as an
`ONBOARD_DOMAIN` job in `BLOCKED`. It did not read an existing verified domain,
provider authorization, or workspace provider grant. A reusable domain was
therefore indistinguishable from a policy/security denial.

## Current resolver chain

`POST /v3/onboarding` → `beginOnboarding` → discovery-only
`customDomainOnboarding` → server reads → `resolveEffectiveAuthority` →
`nexora_add_mailbox_requests` → app status mapping.

Only server records participate in grants:

1. mailbox grant (most specific)
2. verified-domain provider grant
3. tenant grant, when available
4. workspace/organization provider grant
5. provider capability evidence and workspace policy

Credentials, OAuth responses, and raw scopes are never accepted from the app
request. The resolver returns source names and boolean evidence only.

## User-visible mapping

| Resolver status | App wording | Blocked |
| --- | --- | --- |
| `READY_TO_ADD` | Ready to add | No |
| `DOMAIN_REUSED` | Existing domain reused | No |
| `MAILBOX_ALREADY_EXISTS` | Mailbox already exists | No |
| `USER_CONSENT_REQUIRED` | Authorization required | No |
| `ADMIN_CONSENT_REQUIRED` | Admin approval required | No |
| `PARTIAL_AUTHORITY_AVAILABLE` | Limited access | No |
| `PROVIDER_CAPABILITY_LIMITED` | Provider limitation | No |
| `POLICY_BLOCKED` | Blocked by workspace policy | Yes |
| `SECURITY_BLOCKED` | Blocked by security policy | Yes |
| `PROVIDER_ERROR` | Provider error | No |

Only workspace policy and security restrictions are rendered as generic
blocked states. An existing verified domain is marked `domain_reused`; missing
mailbox consent is a continuation state, never a failure.
