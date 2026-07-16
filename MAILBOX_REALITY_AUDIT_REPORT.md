# Mailbox Reality Audit Report

Date: 2026-07-07

## Dimensions
- Provider state: OAuth Gmail API or legacy IMAP.
- Sync state: connected, syncing, needs_reconnect.
- Capability state: read/send only when supported by the current credential and backend contract.
- Ledger state: Global Message Ledger metadata, not UI assumption.
- Recovery state: OAuth reconnect for legacy IMAP Gmail.

## Findings
- OAuth Gmail account `52` is connected and imported into the ledger.
- Legacy IMAP Gmail accounts are not receive-verifiable on Cloudflare Workers and are marked `needs_reconnect`.
- Account capability contract V2 no longer returns read/send enabled for `needs_reconnect` Gmail accounts.
