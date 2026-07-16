# Refresh Audit Report

Date: 2026-07-07

## Result
- Manual/app refresh remains routed through backend Gmail sync.
- Backend sync now returns imported/fetched/cache-reused counts.
- Legacy IMAP refresh no longer spins or silently hangs; it fails fast with OAuth reconnect guidance.

## Evidence
- `GmailSyncResponse` includes `synced`, `fetched`, `cacheReused`, and `skipped`.
- AppState status text reports imported/fetched/cached counts.
- Worker route `/gmail/receive-reality/probe` exists for authenticated receive reality checks.
