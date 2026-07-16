# P31 Generic Enterprise Security Foundation Report

## Status

`enterprise_security_foundation = READY`

## Models

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

Legal Hold > Retention > Expiration > User Delete

## Boundary

P31 implements foundation/API/schema/guards only. User-facing Secure Send and lifecycle enforcement remain P32 work.
