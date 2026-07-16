# All Mail Aggregation Root Cause Report

Date: 2026-07-06

## Root Cause Classification

- `AUTHORIZED_IDENTITY_NOT_INCLUDED_IN_ALL_MAIL`
- `ALL_MAIL_QUERY_EXCLUDES_DELEGATED_OR_OWNER_PASSWORD_IDENTITIES`
- `OUTBOUND_LEDGER_NOT_JOINED_TO_ALL_MAIL`
- `SENT_FOLDER_NOT_MAPPED_TO_ALL_MAIL`
- `OUTBOX_TABLE_NOT_MAPPED_TO_ALL_MAIL`
- `DRAFTS_NOT_MAPPED_TO_ALL_MAIL`
- `PRODUCTION_WORKER_NOT_DEPLOYED`

## Findings

- The backend email list path used `allReceive` as an account filter bypass, but still constrained rows to the current `user_id`.
- Active mailbox authorizations were exposed by the account list endpoint, but were not used as All Mail read scopes.
- The iOS All Mail page rendered only backend inbound messages in normal All Mail mode.
- Local sent, outbox, draft, and scheduled records were visible only from their dedicated folders.
- Inbound rows already had a source mailbox chip, but the missing authorized identity query prevented the bill mailbox row from reaching the device.

## Fix

- Backend All Mail now builds an all-receive scope from current user mail plus active `mailbox_authorizations`.
- Account source metadata now follows the message owner by joining account rows on `email.userId`.
- iOS All Mail now includes a unified local ledger for sent, outbox, drafts, and scheduled records.
