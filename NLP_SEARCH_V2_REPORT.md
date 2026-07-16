# NLP Search V2 Report

Date: 2026-07-07

Status: `PASS`

NLP Search V2 is implemented in Enterprise Hub.

Validated query examples:
- emails from bill last month
- attachments from admin
- contracts from legal
- unread invoices
- emails waiting for reply

The V2 parser is local-first and maps common business intents onto message/contact/attachment/thread graph filters.

Boundary: no external AI provider, customer mailbox export, or cloud search provider is required.
