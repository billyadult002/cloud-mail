# P31 hengmao.org Real Domain Validation Report

Domain: `hengmao.org`

## Validation

- Domain discovered: PASS
- DNS state known: PASS
- Readiness state produced: PASS
- MX status known: READY
- SPF status known: READY
- DKIM status known: READY
- DMARC status known: MISSING
- Inbound readiness known: READY
- Outbound readiness known: BLOCKED
- Mailbox/identity readiness known: READY_PENDING_OUTBOUND
- Security foundation initialized in source: READY

## Final Real Domain State

`PARTIAL_WITH_REAL_BLOCKER`

Blockers:

1. `_dmarc.hengmao.org` TXT is missing.
2. Cloudflare Email Sending API returned `Unauthorized [code: 2036]`.

No READY claim is made.
