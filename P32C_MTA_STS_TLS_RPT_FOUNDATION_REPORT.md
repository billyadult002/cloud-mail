# P32C MTA-STS / TLS-RPT Foundation Report

## Status

`mta_sts_tls_rpt_foundation = READY`

## Implemented

- `_mta-sts.<domain>` TXT desired-state support.
- `mta-sts.<domain>/.well-known/mta-sts.txt` policy readiness metadata.
- `_smtp._tls.<domain>` TXT desired-state support.
- Policy mode model: `none`, `testing`, `enforce`.
- Default desired mode: `testing`.
- TLS report destination metadata.
- HTTPS/certificate readiness metadata.
- BIMI metadata-only state.

## Real Domain Evidence

- `_mta-sts.hengmao.org` TXT: missing.
- `_smtp._tls.hengmao.org` TXT: missing.
- MTA-STS enforce readiness is not claimed.
- TLS-RPT readiness is not claimed for the real domain.
