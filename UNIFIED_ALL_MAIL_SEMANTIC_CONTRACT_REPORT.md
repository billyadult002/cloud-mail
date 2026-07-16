# Unified All Mail Semantic Contract Report

Date: 2026-07-06

All Mail is the unified message ledger across every active owned account, every active receive-capable authorized identity, and local outbound lifecycle records.

## Required Fields

- `message_id`
- `thread_id`
- `account_id`
- `identity_id`
- `mailbox_email`
- `provider`
- `direction`
- `folder`
- `system_label`
- `status`
- `delivery_truth_state`
- `sync_state`
- `from`
- `to`
- `subject`
- `date`
- `has_attachments`
- `attachment_count`
- `source_endpoint`
- `last_seen_at`
- `dedupe_key`

## Rules

- One normalized logical message per provider message id, RFC Message-ID, or normalized fallback key.
- Labels and folders are views, not duplicate logical messages.
- Sent, outbox, drafts, scheduled, reply-created, and forward-created records appear as direction/status states.
- ProviderAccepted does not equal Delivered.
- `received_confirmed` requires actual recipient mailbox evidence.
- All Mail must include all active accounts and active authorized identities.
