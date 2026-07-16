# ATTACHMENT_ALL_MAIL_LEDGER_REPORT

## Status
REAL_IPHONE_AND_GUARD_PASS

## Guarded Contract
- `/v2/mail/all` remains active.
- Global ledger includes attachment fields:
  - `has_attachments`
  - `attachment_count`
  - `direction`
  - `status`
  - `delivery_truth_state`
  - `mailbox_email`
- iOS decodes/surfaces `attachmentCount` through `attachmentSignalCount`.
- ProviderAccepted is not labeled Delivered in All Mail.

## Real iPhone Result
- Outbound local sent ledger confirmed subject `CloudMail attachment real-use test 20260706-151301`.
- Outbound state: `provider_accepted`.
- Outbound attachment count: `1`.
- Inbound received row visible in All Mail/inbox for `admin@fastonegroup.com`.
- ProviderAccepted was not labeled Delivered.
