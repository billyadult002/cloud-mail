# P31B hengmao.org Pre-Apply DNS Revalidation

## Public DNS

- `hengmao.org` MX resolves to Cloudflare Email Routing:
  - `route3.mx.cloudflare.net`
  - `route1.mx.cloudflare.net`
  - `route2.mx.cloudflare.net`
- `hengmao.org` SPF is present:
  - `v=spf1 include:_spf.mx.cloudflare.net ~all`
- `cf2024-1._domainkey.hengmao.org` DKIM is visible through Cloudflare Email Routing DNS inspection.
- `_dmarc.hengmao.org` TXT returns no answer / NXDOMAIN from public DNS.

## Cloudflare Routing

- Email Routing for `hengmao.org` is enabled.
- Email Routing status is `ready`.
- Catch-all rule is enabled and targets `worker:cloud-mail`.

## Pre-Apply Decision

`dmarc_status = MISSING`

The desired DMARC record remains:

`v=DMARC1; p=quarantine; rua=mailto:dmarc@hengmao.org; adkim=s; aspf=s`
