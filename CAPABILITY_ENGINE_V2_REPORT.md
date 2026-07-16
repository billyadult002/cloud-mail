# Capability Engine V2 Report

## Result
PASS.

Gmail capabilities are no longer inferred from provider type alone.

## Rules
- `mailbox_ready`: read/send/attachments/threads/labels true.
- `first_import_pending`: read/send false, recovery `RUN_IMPORT_RECOVERY`.
- `legacy_imap_unsupported`: read/send false, recovery `RECONNECT_OAUTH`.
- CloudMail native keeps its own ready/send path.

## Evidence
- Updated capability guards PASS.
- Worker tests PASS.

