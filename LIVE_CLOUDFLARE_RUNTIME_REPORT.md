# GPT65_6R Live Cloudflare Runtime Report

Date: 2026-07-10  
Account: `9a13d1cf25750a43faa1d96ebc66920b`  
Worker: `cloud-mail`

## Evidence

- Wrangler authentication: PASS (`saercpku@gmail.com`, required worker/D1/email-routing scopes present).
- Latest observed deployment: `a156fb37-f08e-4862-9d2b-6454fc9daa4f`, created 2026-07-10 00:10 UTC.
- D1 database: `cloud-mail`, id `4c05f52d-5d8c-4fb5-9a6d-888bebf8c596`, remote query succeeded in `WNAM/DEN`.
- Production migrations 0023, 0024 and 0025 are applied.
- Email Routing catch-all: enabled, action `worker:cloud-mail`.
- Explicit routes: `bill@hengmao.org` and `tmc@hengmao.org` forward to `tianmaofeng@gmail.com`; `info@hengmao.org` forwards to `bill@fastonegroup.com`; `account@hengmao.org` forwards to `1063321927@qq.com`.
- Live API `/api/auth/email-discovery` responded successfully; P31/P32C protected endpoints returned 401 without a session.

## Drift / blockers

- Live response still contains `access-control-allow-origin: *`; this is inconsistent with the local restricted-CORS hardening and requires deployment before claiming runtime security closure.
- D1 domain tables contain no `hengmao.org` row in `cloudmail_domains`, `domain_ownership`, `domain_capabilities`, `domain_readiness_snapshots`, or `domain_reconciler_snapshots`.

Decision: **BLOCKED**.
