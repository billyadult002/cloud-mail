# P31A Safe DMARC Autoconfig Boundary Report

## Status

`safe_autoconfig_boundary = PRESERVED`

## Boundary

- Dry-run is the default.
- Apply requires explicit `mode=apply`.
- Apply also requires `CLOUDMAIL_P31_AUTOCONFIG_APPLY_ENABLED=true`.
- Existing valid DMARC is preserved.
- Invalid or conflicting DMARC records are reported, not overwritten.
- Every autoconfig attempt records an audit event when the audit table is available.

## Local Apply Availability

- `CLOUDFLARE_API_TOKEN = ABSENT`
- `CLOUDMAIL_P31_AUTOCONFIG_APPLY_ENABLED = ABSENT`

Therefore no real DNS write was attempted.
