# Receive Capability Report

Date: 2026-07-07

## Update
- Gmail receive capability now depends on credential reality.
- OAuth Gmail: receive enabled when Gmail API sync and ledger evidence exist.
- Legacy IMAP Gmail: receive disabled with `TOKEN_REFERENCE_MISSING`/OAuth reconnect guidance.

## Production Evidence
- Account `52`: `connected`, OAuth, last synced `2026-07-07 19:39:17`.
- Account `44`: `needs_reconnect`, `legacy_imap_unsupported`.
- Account `46`: `needs_reconnect`, `legacy_imap_unsupported`.
- Account `47`: `needs_reconnect`, `legacy_imap_unsupported`.
