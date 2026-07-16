# P31 Mailbox / Identity / Capability Provisioning Report

P31 added mailbox and identity foundation models in migration `0023_p31_domain_security_foundation.sql`:

- `mailboxes`
- `domain_identities`
- `domain_capabilities`

The source foundation supports:

- domain-to-mailbox binding
- routing association state
- send capability state
- receive capability state
- account health state
- admin linkage state

## Real hengmao.org Status

- Receive capability: ready from Cloudflare Email Routing and catch-all worker path
- Send capability: blocked by outbound provider readiness
- Mailbox/identity final state: `READY_PENDING_OUTBOUND`

No production database migration was executed.
