# Gmail Lifecycle Reconnect Freshness Real Device Closure Report

Date: 2026-07-07

## Outcome
PASS for source, Worker production deployment, OAuth Gmail freshness path, reconnect UI routing, All Mail ordering, and real iPhone install/launch.

## Root Cause
- iOS foreground refresh synced only the selected Gmail account or the first two Gmail accounts.
- Worker fallback Gmail cron was configured at 30 minutes, too slow for browser Gmail parity expectations.
- The Worker scheduled handler only recognized the old `*/30 * * * *` cron string.
- Accounts detail actions routed Gmail reconnect into the add-account connector instead of Google OAuth reconnect for the current mailbox.
- `needs_reconnect` / `legacy_imap_unsupported` labels were not explicit enough in Account Center.

## Fixes
- Foreground refresh now syncs every eligible Gmail / Google Workspace account, excluding legacy IMAP and blocked states from false success.
- Foreground and manual Gmail sync now request a 100-message page from Gmail API.
- Worker Gmail fallback cron is now every 5 minutes.
- Worker scheduled handler accepts both `*/5 * * * *` and legacy `*/30 * * * *`.
- Worker fallback batch defaults increased to 8 accounts and 50 messages per account.
- Account Center Gmail reconnect now launches Google OAuth with the current `accountId`.
- Gmail lifecycle labels now show `Reconnect Required` for `needs_reconnect` and `legacy_imap_unsupported`.
- All Mail and smart group rows sort by received time descending.

## Production Evidence
- Worker deployed: `348ecde6-78c1-4f39-87c2-4544bc7751ae`.
- Production schedule deployed:
  - `*/5 * * * *`
  - `0 16 * * *`
- Post-deploy cron evidence:
  - `gmail_sync_runs.id=249`
  - `cron=*/5 * * * *`
  - `batch_size=8`
  - `message_limit=50`
  - `completed_at=2026-07-07 21:05:29`
- Real iPhone foreground launch refreshed OAuth Gmail accounts:
  - `fastonecanada@gmail.com` `mailbox_ready`, `last_synced_at=2026-07-07 21:04:48`
  - `tianmaofeng@gmail.com` `mailbox_ready`, `last_synced_at=2026-07-07 21:04:47`
  - `saercpku@gmail.com` OAuth rows `mailbox_ready`, latest `last_synced_at=2026-07-07 21:00:57`

## Legacy Gmail Truth
- `billyadult006@gmail.com` and `billyadult008@gmail.com` remain `needs_reconnect` / `legacy_imap_unsupported`.
- This is correct until Google OAuth is completed for those specific current mailbox account IDs.
- CloudMail no longer routes those rows to Add Account; it routes them to Google OAuth Reconnect Current Mailbox.

## Verification
- Mandatory repository precheck: PASS.
- Gmail realtime sync/reconnect closure guard: PASS.
- Mailbox lifecycle truth guard: PASS.
- Provider truth receive reality guard: PASS.
- Account capability V2 final guard: PASS.
- Backend send eligibility guard: PASS.
- Restored account send capability guard: PASS.
- Account capability receive-only guard: PASS.
- Worker tests: PASS.
- iOS generic-device Release build: PASS.
- Worker production deploy: PASS.
- Owner-signed IPA build: PASS.
- Real iPhone USB install: PASS.
- Real iPhone launch: PASS.

## Boundaries
- `verify.sh`: NOT RUN.
- Production migration: NOT RUN.
- Secrets/tokens/OAuth codes/refresh tokens/browser cookies: NOT READ OR EXPOSED.
- Browser Gmail parity for legacy IMAP accounts: NOT CLAIMED until their Google OAuth reconnect is completed.
