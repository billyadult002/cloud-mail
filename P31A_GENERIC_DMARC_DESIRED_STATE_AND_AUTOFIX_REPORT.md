# P31A Generic DMARC Desired-State And Autofix Report

## Status

`generic_dmarc_autofix = READY`

## Implemented

- Detects missing DMARC.
- Detects invalid DMARC.
- Detects conflicting multiple DMARC records.
- Preserves an existing valid DMARC record.
- Generates a safe generic default DMARC record:
  - `v=DMARC1; p=quarantine; rua=mailto:dmarc@<domain>; adkim=s; aspf=s`
- Does not hardcode `hengmao.org`.

## Files

- `platform/cloud-mail/mail-worker/src/service/p31-domain-foundation-service.js`
- `platform/cloud-mail/mail-worker/scripts/reliability-tests/p31-domain-foundation.test.mjs`
- `scripts/guards/p31_domain_security_foundation_guard.py`

## Notes

If an existing valid DMARC record has no `rua`, it is still treated as syntactically ready and preserved.
