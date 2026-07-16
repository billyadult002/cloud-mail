# OAuth Callback Audit Report

Date: 2026-07-07

## Root Cause
OAuth callback/account binding was not the only failure point. OAuth references existed on some rows, but first import failed with:

`D1_ERROR: variable number must be between ?1 and ?100`

That error came from oversized duplicate/cache lookup chunks.

## Fix
- Gmail duplicate/cache lookup chunks reduced to 80.
- Non-auth failures no longer change OAuth-connected accounts to `needs_reconnect`.
- Evidence-based `mailbox_ready` promotion was added after ledger evidence exists.

## Result
OAuth-backed accounts 44, 45, and 46 are now `mailbox_ready`.
