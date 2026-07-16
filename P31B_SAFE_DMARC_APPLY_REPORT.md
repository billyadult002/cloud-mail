# P31B Safe DMARC Apply Report

## Status

`dmarc_apply = NOT_APPLIED_BLOCKED_WITH_REAL_REASON`

## Dry-Run Result

The generic desired-state engine would create a single non-destructive DMARC TXT record when no existing valid DMARC is present:

- Type: `TXT`
- Name: `_dmarc.<domain>`
- Policy: `p=quarantine`
- Alignment: `adkim=s; aspf=s`
- Existing valid DMARC records are preserved.
- Invalid or conflicting DMARC records are reported without destructive overwrite.

## Apply Boundary

Apply was not executed because both required safe-write conditions were not available in this runtime:

- Worker API path: `CLOUDFLARE_API_TOKEN` absent.
- Explicit P31 apply gate: `CLOUDMAIL_P31_AUTOCONFIG_APPLY_ENABLED` absent.
- Wrangler path: logged in, but available CLI does not provide a safe generic DNS TXT write command for DMARC.

No destructive DNS overwrite was attempted.
