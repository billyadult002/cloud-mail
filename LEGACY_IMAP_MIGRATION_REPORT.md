# Legacy IMAP Migration Report

## Result
PASS for truthful legacy handling.

Legacy IMAP Gmail remains unsupported on Cloudflare Worker runtime and is no longer represented as ready/connected receive capability.

## Current State
Legacy Gmail accounts are shown as:
- `needs_reconnect`
- `legacy_imap_unsupported`
- Recovery: Reconnect current mailbox with Google OAuth

Historical imported rows do not override the current reconnect requirement.

