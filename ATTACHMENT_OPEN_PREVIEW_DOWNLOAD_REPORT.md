# ATTACHMENT_OPEN_PREVIEW_DOWNLOAD_REPORT

## Status
REAL_IPHONE_OPEN_PREVIEW_DOWNLOAD_PASS

## Code/Guard Result
- Attachment Open downloads the remote attachment to a local temporary file before preview.
- Preview uses iOS Quick Look.
- Download uses `UIActivityViewController` with the local file.
- The old behavior of sharing the remote URL directly is guarded against.
- Worker `/attachments/...` route reads through R2 object storage and returns 404 instead of throwing when missing.

## Real iPhone Result
- Attachment preview opened on real iPhone and displayed:
  - `CloudMail safe attachment test.`
  - `Timestamp: 20260706-151301`
  - `No private data.`
  - `No customer data.`
  - `No personal report content.`
- No Cloudflare 1101 page appeared.
- No crash or stuck spinner observed.
- Download/share opened a local file activity sheet.
- The activity sheet identified the file as `Text Document · 121 bytes`.
- `Save to Files` was visible.
