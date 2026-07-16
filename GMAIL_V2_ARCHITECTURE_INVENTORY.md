# Gmail V2 Architecture Inventory

## Status

`architecture_inventory = COMPLETE`

## Current Paths

- Legacy Gmail IMAP runtime: `gmail-imap-service.js`, `/gmail/connect`, `/gmail/sync`.
- Gmail REST send runtime: Gmail API `messages.send`.
- Gmail REST import/runtime foundation: Gmail API message listing and metadata-first import helpers.
- OAuth/runtime credential path: backend-held Google OAuth credential references.
- Diagnostics/capability/health paths: existing account diagnostics plus new Gmail Platform V2 contracts.

## Coupling Points Identified

- Governance approval was historically easy to confuse with OAuth/provider failure.
- Connected account state was too easy to infer as Can Send or Can Receive.
- OAuth success was too easy to infer as Mailbox Ready.
- Sync status, lifecycle, capability, health, and recovery needed one truth platform.

## Decision

All new Gmail functionality must use Google OAuth + Gmail REST API. IMAP is migration/reconnect recovery only and never primary runtime.
