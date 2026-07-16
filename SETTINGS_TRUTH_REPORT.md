# Settings Truth Report

Date: 2026-07-07

## Result
PASS.

## Change
Settings Mail Client counters now label their evidence source:
- Drafts: local draft ledger
- Sent: local sent ledger
- Outbox: local outbox ledger
- Scheduled: local schedule ledger or not enabled
- Unread: Global Message Ledger
- All Mail: unified ledger view

## Purpose
This prevents local UI ledgers from being mistaken for provider delivery or receive proof.
