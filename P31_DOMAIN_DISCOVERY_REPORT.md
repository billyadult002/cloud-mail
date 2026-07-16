# P31 Domain Discovery Report

Task: `CLOUDMAIL_V2_P31_ZERO_TOUCH_DOMAIN_AND_SECURITY_FOUNDATION_EXECUTION`

Domain: `hengmao.org`

Date: 2026-07-06

## Real Cloudflare / DNS State

- Cloudflare account reference observed through Wrangler login: `9a13d1cf25750a43faa1d96ebc66920b`
- Zone/tag reference observed by Email Routing commands: `18392dbe5f27c8e385e9631b0e69f8fa`
- Nameservers: `meg.ns.cloudflare.com`, `walt.ns.cloudflare.com`
- Email Routing: enabled
- Email Routing status: ready
- MX: Cloudflare Email Routing MX present
  - `route3.mx.cloudflare.net` priority 60
  - `route1.mx.cloudflare.net` priority 82
  - `route2.mx.cloudflare.net` priority 96
- SPF: `v=spf1 include:_spf.mx.cloudflare.net ~all`
- DKIM: Cloudflare routing DKIM present at `cf2024-1._domainkey.hengmao.org`
- DMARC: no `_dmarc.hengmao.org` TXT observed
- Catch-all: enabled, action `worker:cloud-mail`
- Explicit routing rules currently forward:
  - `bill@hengmao.org`
  - `tmc@hengmao.org`
  - `info@hengmao.org`
  - `account@hengmao.org`
- Email Sending: Cloudflare API returned `Unauthorized [code: 2036]`

## Discovery Boundary

No secrets, tokens, cookies, mailbox content, or attachment content were printed or stored.

## Discovery Result

`domain_discovery = PASS`

Final domain readiness is not READY because DMARC is missing and Cloudflare Email Sending is blocked by API authorization.
