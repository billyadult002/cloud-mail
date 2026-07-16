# DMARC Runtime Report

Status: **REQUIRES_EXTERNAL_OWNER**

- Query `_dmarc.hengmao.org`: no TXT answer.
- Desired application policy from P31 is `v=DMARC1; p=quarantine; ...; adkim=s; aspf=s`.
- Wrangler authentication is valid for Workers/email routing/D1 but only has `zone:read`; it lacks DNS write scope.
- Direct Cloudflare API edit attempt with the Wrangler OAuth credential returned `Authentication error`.

This blocker cannot be corrected safely by the current execution identity. A Cloudflare zone owner must grant DNS edit authority or publish the approved DMARC record.
