# Sent Outbox Drafts All Mail Integration Report

Date: 2026-07-06

## Implemented

- Sent messages appear in All Mail local ledger with `Sent` direction and ProviderAccepted/Delivered truth boundary.
- Outbox messages appear with retry/failure error text.
- Drafts appear with draft status and recipient/source identity.
- Scheduled messages appear with scheduled status.
- Attachment counts are preserved for local lifecycle rows.

ProviderAccepted is displayed as provider accepted or receipt pending, not Delivered.
