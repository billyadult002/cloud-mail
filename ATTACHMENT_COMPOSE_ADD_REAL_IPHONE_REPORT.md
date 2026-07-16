# ATTACHMENT_COMPOSE_ADD_REAL_IPHONE_REPORT

## Status
REAL_IPHONE_PASS

## Implemented Safe Path
- Compose supports normal user file selection through the system file importer.
- Debug real-device build also exposes a `Safe Test` button that creates a synthetic `text/plain` attachment.
- The synthetic attachment uses the same `LocalAttachmentDraft` and send payload path as selected files.

## Current Real iPhone State
- App installed and launched on device `70CD0BB3-0832-5A94-BA91-82A634A54CF8`.
- Evidence screenshot: `evidence/cloudmail-attachment-real-use-debug-build-launch.png`.
- Manual Compose navigation is pending.

## Real iPhone Result
- Compose opened on real iPhone.
- Safe synthetic attachment was added through the Debug-only smoke path.
- Attachment row/card appeared.
- Filename visible: `cloudmail-safe-attachment-test-20260706-151301.txt`.
- MIME/size visible: `text/plain · 121 bytes`.
- No stuck spinner observed.
