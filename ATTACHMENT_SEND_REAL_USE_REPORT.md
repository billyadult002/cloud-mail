# Attachment Send Real Use Report

Date: 2026-07-06

## Result

`CODE_GUARDED_REAL_SEND_NOT_PERFORMED_PRIVATE_ATTACHMENT_DECLINED`

## Implemented

- Attachment chip shows filename, MIME type, and size.
- Attachment import infers MIME type using `UTType`.
- Per-file raw size limit is enforced.
- Total raw size limit is enforced.
- Base64 encoded payload size is checked.
- Risky executable extensions are blocked.
- Attachment sends expose uploading state before send.

## Real iPhone Boundary

- Compose attachment entry point was visible on real iPhone.
- A real iPhone attachment file was not selected because no explicitly authorized safe file was available in the phone Files picker.
- Attachment send was not tapped.
- User suggested `/Users/billtin/Documents/ANDREA 2026 REPORT CARD.pdf`; it was not used because it appears to contain private report-card content and this task requires no private/customer attachment content.

## Claims Not Made

- Provider accepted attachment send: NOT CLAIMED.
- Attachment received/opened: NOT CLAIMED.
