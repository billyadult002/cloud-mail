# Attachment Authorization Report

Status: **PASS (code-level; deployment replay required)**

- `/oss/*` is no longer an unauthenticated security exclusion.
- Gmail attachment keys verify the account belongs to the authenticated user before using the mailbox OAuth token.
- Generic keys must have a matching `attachments.key` row owned by the authenticated user.
- `/attachments/*` is routed through `/oss/*`, removing the direct public object bypass.
- Responses use `private, no-store` and `nosniff`.

Required deployment test: request a foreign user’s key with a valid session and assert 404/403; request without a session and assert 401.
