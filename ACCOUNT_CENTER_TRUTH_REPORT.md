# Account Center Truth Report

Date: 2026-07-07

## Truth Model
- `mailbox_ready`: show usable Gmail mailbox.
- `legacy_imap_unsupported` or legacy `needs_reconnect`: show Google OAuth reconnect.
- Non-auth import recovery: show import recovery, not OAuth reconnect.

## Current Truth
- Ready: `billyadult006@gmail.com`, OAuth-backed `saercpku@gmail.com`, OAuth-backed `tianmaofeng@gmail.com`.
- Reconnect required: `billyadult008@gmail.com` and legacy `saercpku@gmail.com` owner row 42.

## Notes
Account Center should not show Add Account for reconnect; it should reconnect the current mailbox accountId.
