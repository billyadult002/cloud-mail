# GPT65_6R Live DNS Runtime Report

Domain: `hengmao.org`

Observed via public DNS at 2026-07-10:

- MX: `route3.mx.cloudflare.net` priority 60, `route1.mx.cloudflare.net` priority 82, `route2.mx.cloudflare.net` priority 96.
- SPF: `v=spf1 include:_spf.mx.cloudflare.net ~all`.
- DKIM: `cf2024-1._domainkey.hengmao.org` exists with `v=DKIM1`, RSA public key.
- DMARC: `_dmarc.hengmao.org` returned no record.
- Additional/conflicting MX: none observed beyond the three Cloudflare route hosts.
- Conflicting SPF: none observed; policy is soft-fail (`~all`), not strict enforcement.
- Conflicting DMARC: no conflicting record; the required record is missing.

Decision: **REQUIRES_EXTERNAL_OWNER** — DMARC is missing and SPF is not enforcement-grade; current Wrangler identity has no DNS write authority.
