# Gmail OAuth 403, Governance, and Future-Time Root Cause Report

Date: 2026-07-07

## Root Causes

1. Google OAuth 403 for `billyadult008@gmail.com`, `billyadult01@gmail.com`, and `zhaotianwy@gmail.com` was caused by Google Auth Platform test-user eligibility, not by CloudMail mailbox sync. The OAuth app is in Testing mode and those addresses were not in the Google test-user list.

2. Access Governance did not always show a request because Google Access Blocked can stop the browser before it returns to the CloudMail callback. The old path recorded denied access only after callback error handling, so no callback meant no governance row.

3. Future-looking Gmail messages were possible because Gmail API ingestion used the parsed RFC822 `Date` header as the primary received timestamp. Some messages can carry sender-controlled future or timezone-skewed Date headers. Gmail API `internalDate` is the provider-owned received-time source and must be used first.

## Fixes

- Added OAuth preflight governance recording before redirecting to Google in `gemini-oauth-service.js`.
- Updated Gmail API ingestion to carry `internalDate` from Google and use it before parsed header dates in `gmail-imap-service.js`.
- Extended `gmail_realtime_sync_reconnect_closure_guard.py` to fail if either protection disappears.
- Added `billyadult008@gmail.com`, `billyadult01@gmail.com`, and `zhaotianwy@gmail.com` to Google Auth Platform test users in project `clawfeed-490710`.

## Important Product Rule

Real Gmail add/reconnect is complete only when performed through the real CloudMail iPhone UI and Google OAuth consent flow. Backend rows can verify root cause and system health, but they do not count as adding a Gmail account.
