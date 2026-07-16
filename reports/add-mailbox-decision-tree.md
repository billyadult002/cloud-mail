# Add-mailbox decision tree

```text
Email input
  ↓
Identity and mailbox-provider discovery
  ↓
Infrastructure-provider discovery
  ↓
Read server-side mailbox/domain/tenant/organization grants
  ↓
EffectiveAuthorityResolver
  ├─ security restriction ───────────────→ SECURITY_BLOCKED
  ├─ workspace policy restriction ───────→ POLICY_BLOCKED
  ├─ existing mailbox ───────────────────→ MAILBOX_ALREADY_EXISTS
  ├─ provider cannot supply enterprise need → PROVIDER_CAPABILITY_LIMITED
  ├─ core authority + optional gap ──────→ PARTIAL_AUTHORITY_AVAILABLE
  ├─ verified mailbox/core authority ────→ READY_TO_ADD
  └─ verified reusable domain, consent due → USER_CONSENT_REQUIRED
  ↓
Persist `nexora_add_mailbox_requests`
  ↓
App-native status mapping and next action
```

The former conversion point was `beginOnboarding`: it constructed an empty
grant model then inserted `ONBOARD_DOMAIN` with `state='BLOCKED'` and
`VERIFIED_PROVIDER_AUTHORITY_REQUIRED`. That generic conversion has been
removed. The authoritative persisted record is now an add-mailbox request with
`READY`, `AWAITING_CONSENT`, or `BLOCKED` only for policy/security denial.
