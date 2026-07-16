# Unified All Mail Send Receive Sent Outbox Final Report

Date: 2026-07-06

Final status: `CLOUDMAIL_UNIFIED_ALL_MAIL_SEND_RECEIVE_REAL_IPHONE_PASS`

## Completed

- Root cause identified.
- Backend All Mail authorization scope fixed in source.
- iOS All Mail local lifecycle ledger added.
- Sent/outbox/drafts/scheduled rows now feed the visible All Mail ledger in the app source.
- ProviderAccepted != Delivered boundary preserved.
- Guards added for All Mail contract, all accounts, authorized identities, bill mailbox visibility contract, local lifecycle rows, attachments, dedupe, and source badges.
- Production Worker deployed after user authorization:
  - `fda6786f-73f9-4654-a454-aa033f1e271a`
  - `bb46b9bf-070f-4846-96d8-951f6cf42e71`
- Production D1 read-only metadata confirmed the bill inbound row exists and the active authorization exists.
- Real iPhone validation confirmed the local unified sent ledger appears for the test subject and preserves ProviderAccepted != Delivered.
- Backend Global Message Ledger endpoint added: `/v2/mail/all`.
- iOS All Mail now consumes `/v2/mail/all` instead of the legacy receive-only list when no account is selected.
- Production Worker deployed after final fix: `06385211-843d-4991-a244-116fcb017809`.
- Real iPhone All Mail loaded the Global Message Ledger without a stuck spinner.
- Real iPhone search for `121605` showed:
  - local sent ledger row
  - inbound row with `Received by bill@fastonegroup.com`
  - outbound row from `saercpku@gmail.com`

## Not Claimed

- Production deploy: AUTHORIZED / RUN.
- Production migration: NOT AUTHORIZED / NOT RUN.
- `verify.sh`: NOT RUN.
- Real iPhone bill-row All Mail PASS: CLAIMED after manual validation.
- Delivered: NOT CLAIMED beyond the authorized bill mailbox received evidence for the named subject.
- Endurance, thermal, battery, memory: NOT OBSERVED.
