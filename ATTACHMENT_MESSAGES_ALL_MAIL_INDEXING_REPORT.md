# Attachment Messages All Mail Indexing Report

Date: 2026-07-06

## Contract

- `has_attachments` must be true for attachment-bearing rows.
- `attachment_count` must match safe metadata, not file contents.
- MIME/safe-open metadata must remain available.
- Reports must not include private attachment content.

## Implemented

- iOS local ledger displays attachment count for sent, outbox, and draft records.
- Existing unsafe attachment extension and encoded-size protections remain active.

Private attachment content was not used or written to reports.
