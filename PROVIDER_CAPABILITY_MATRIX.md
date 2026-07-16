# Provider Capability Matrix

| Provider | Declared capabilities | Implementation truth | Live validation |
| --- | --- | --- | --- |
| Cloudflare | Zone/DNS/routing discovery, read/write, repair | Read verification + bounded monitoring operational; writes remain scope-gated | Admin credential available; no V3 domain verified |
| Google Workspace | Gmail, Calendar, Directory, identity/groups | Gmail existing; V3 scope contract implemented; admin/calendar adapter not live-validated | BLOCKED: provider consent absent |
| Microsoft 365 / Exchange | Mail, Calendar, Directory, mailbox/groups | Contract declared, truthful `DECLARED_NOT_VALIDATED` | BLOCKED: tenant consent absent |
| Fastmail | JMAP mail/submission/calendar, aliases | Contract declared | BLOCKED: authorization absent |
| Zoho | Mail, Calendar, organization/mailbox | Contract declared | BLOCKED: authorization absent |
| Proton | Provider detection | Detection-only; no public admin automation claimed | UNSUPPORTED for full automation |
| Custom IMAP/SMTP | Mail read/send, detection | Credential verification required; never auto-authorized | BLOCKED: credentials absent |
| Custom Domain | DNS/provider detection | Custom-domain-first planning operational | BLOCKED until DNS-provider authority |

Status: **PASS (complete truthful matrix); PARTIAL (operational adapters).**
