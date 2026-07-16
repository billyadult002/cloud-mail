# P31 Cloudflare Autoconfig Engine Report

Implemented in `p31-domain-foundation-service.js`.

## Behavior

- Default mode is `validate`.
- `apply` mode is gated by `CLOUDMAIL_P31_AUTOCONFIG_APPLY_ENABLED=true`.
- Existing correct DNS is reused.
- Missing records are planned, not destructively applied.
- The only default safe write candidate is DMARC monitoring (`p=none`) when apply is explicitly enabled.
- Conflicting records are not overwritten by default.

## Real hengmao.org Result

- MX: existing Cloudflare MX reused
- SPF: existing Cloudflare SPF reused
- DKIM: existing Cloudflare routing DKIM detected
- DMARC: missing, planned as safe monitoring record
- Email Routing: ready
- Catch-all: ready, worker action `cloud-mail`
- Email Sending: blocked by Cloudflare API `Unauthorized [code: 2036]`

No Cloudflare DNS mutation was performed in this loop.
