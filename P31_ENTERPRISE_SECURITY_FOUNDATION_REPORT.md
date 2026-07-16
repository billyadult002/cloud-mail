# P31 Enterprise Security Foundation Report

P31 added additive security foundation schema:

- `retention_policies`
- `expiration_policies`
- `legal_holds`
- `security_classifications`
- `secure_link_metadata`
- `audit_events`
- `message_security_state`
- `attachment_security_state`
- `domain_security_policy`

## Rule Precedence

`Legal Hold > Retention > Expiration > User Delete`

The lifecycle dry-run enforces that legal hold preserves content even when expiration is reached.

## Safety

- Destructive expiration is disabled by default.
- Secure link metadata is modeled.
- Audit events are modeled.
- No mailbox content or attachment content is logged.
