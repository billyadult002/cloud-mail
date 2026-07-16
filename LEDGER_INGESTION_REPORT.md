# Ledger Ingestion Report

Date: 2026-07-07

## Result
Gmail OAuth ingestion into Global Message Ledger: PASS.

## Evidence
- Run `245`, account `52`, `synced_messages=10`.
- Latest ledger metadata for account `52`: `latest_email_id=1700`, newest message time `2026-07-07T19:12:50.000Z`.
- Legacy IMAP accounts were not allowed to block ledger ingestion for OAuth accounts.

## Safety
Only metadata was used in the final report; mailbox bodies and credentials were not exposed.
