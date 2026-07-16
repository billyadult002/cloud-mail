# Runtime Drift Report

Status: **FIXED for deployed Worker; DNS remains externally blocked**

- Local security/CORS changes deployed to `cloud-mail`; deployment version `b8da5c18-9f0e-4104-892c-5e13872777eb`.
- Live probe with `Origin: https://example.invalid` and cache-busting query returned no `access-control-allow-origin`.
- Live probe with same-origin Worker origin reflected that origin and `access-control-allow-credentials: true`.
- Protected P31/P32C endpoints still return 401 without a session.
- D1, KV, R2, assets, cron bindings were listed successfully during deploy.
- DNS drift is not fixed: DMARC absent and SPF is soft-fail.
