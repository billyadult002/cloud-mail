# Worker Reconnect Account Matching Repair Report

## 1. Audit and Findings
We audited the `upsertGoogleMailbox` function in [gemini-oauth-service.js](file:///Users/billtin/Documents/cloudmail/platform/cloud-mail/mail-worker/src/service/gemini-oauth-service.js) and found that:
- It was restricting matching to `provider IN ('gmail', 'google_workspace')`.
- This prevented reconnects or additions from migrating or mapping legacy Gmail accounts (whose provider column in D1 database is `'imap'` or `'cloudflare_native'`).
- The old provider credentials were not proactively deleted when migrating a legacy account to V2 Google OAuth, leading to orphaned credentials.

## 2. Refactoring Done
We refactored `upsertGoogleMailbox`:
1. Removed the restriction `provider IN ('gmail', 'google_workspace')` from both the requested account SELECT query and the auto-discovery SELECT query.
2. In the auto-discovery query, implemented an explicit ORDER BY sorting preference:
   - Prefer existing `gmail` / `google_workspace` accounts (priority 0)
   - Then existing `imap` Gmail accounts (priority 1)
   - Then existing `cloudflare_native` Gmail accounts (priority 2)
   - Then others
3. Added a step to proactively delete any old credentials for the target account before inserting the new V2 credentials:
   ```javascript
   await c.env.db.prepare(
       `DELETE FROM mail_provider_credentials
         WHERE user_id = ?1 AND account_id = ?2`
   ).bind(userId, accountId).run();
   ```
   This ensures that no orphaned credentials remain and conflicts are avoided.

## 3. Verification
- All 98 vitest tests pass successfully.
- Verified that a legacy `'imap'` or `'cloudflare_native'` Gmail account is successfully matched, its provider column is updated to `'gmail'` / `'google_workspace'` (migrated to V2 REST), and old credentials are replaced safely.
