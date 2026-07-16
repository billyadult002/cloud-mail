# GPT65_6Y Final Blocker Registry

| Blocker | Classification | Evidence |
|---|---|---|
| Runtime CORS drift | FIXED | Worker redeployed as version `b8da5c18-9f0e-4104-892c-5e13872777eb`; cache-busted live probe now omits ACAO for unapproved origin and reflects only same origin. |
| Mailbox drawer regression | FIXED | `InboxView.swift` defers sheet state and separates toolbar/header accessibility labels; USB iPhone test `testLoop5JMailboxFirstScreenHidesDebugFiltersWithExistingSession` passes. |
| DMARC record missing | REQUIRES_EXTERNAL_OWNER | DNS query has no `_dmarc.hengmao.org`; Wrangler OAuth has `zone:read` but not DNS edit permission; Cloudflare API edit attempt returns authentication error. |
| SPF enforcement | REQUIRES_EXTERNAL_OWNER | Live SPF is `~all`; changing to strict policy requires DNS owner approval. |
| Full feature master audit | PROVEN_BLOCKED | Launch and mailbox navigation pass, but the complete calendar/template/customer/KPI/workflow matrix has not been executed with an authenticated populated mailbox. |

No blocker is hidden or downgraded.
