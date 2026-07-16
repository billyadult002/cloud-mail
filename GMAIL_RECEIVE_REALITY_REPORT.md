# Gmail Receive Reality Report

Date: 2026-07-07

## Result
- OAuth Gmail receive path: PASS.
- Legacy IMAP Gmail receive path: BLOCKED WITH EVIDENCE.

## Evidence
- Production scheduled sync run `245`: checked 5 Gmail accounts, synced 1 OAuth account, failed 4 legacy IMAP accounts, completed at `2026-07-07 19:39:18`.
- Account `52` (`fastonecanada@gmail.com`) used OAuth and imported 10 Gmail messages through Gmail API.
- Global Message Ledger for account `52` shows latest Gmail ledger metadata with `latest_email_id=1700`, newest message time `2026-07-07T19:12:50.000Z`.
- Accounts `44`, `46`, `47`, and `42` were `imap_or_legacy` and are now `needs_reconnect` with `legacy_imap_unsupported`.

## Closure
The previous stale/false state is fixed. OAuth Gmail can receive; legacy Gmail no longer claims receive capability and must be reauthorized with Google OAuth.
