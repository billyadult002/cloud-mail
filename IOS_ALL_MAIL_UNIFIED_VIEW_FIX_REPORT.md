# iOS All Mail Unified View Fix Report

Date: 2026-07-06

## Implemented

- All Mail count includes backend inbound rows plus local lifecycle rows.
- All Mail now shows local sent, outbox, drafts, and scheduled rows.
- Inbound rows keep the `Received by` source mailbox badge.
- Local rows show `Sent`, `Outbox`, `Draft`, or `Scheduled` direction text.
- Search can match local ledger subject, recipient, source, status, and attachment detail.
- Pull-to-refresh remains wired to `app.refresh()`.

## Manual Boundary

Real iPhone validation after production Worker deploy and Global Message Ledger integration:

- App installed and launched: PASS.
- All Mail loaded without stuck spinner: PASS.
- All Mail count after Global Message Ledger: visible at `82`.
- Search for `121605`: local unified sent ledger visible.
- Local sent ledger status: `Provider accepted; delivery not confirmed`, not Delivered.
- Bill inbound row with source `bill@fastonegroup.com`: VISIBLE in the app search.
- Outbound backend row from `saercpku@gmail.com`: VISIBLE in the app search.

Full All Mail real iPhone PASS is claimed for this named test message.
