#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]

app_state = (ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text()
accounts_view = (ROOT / "files/GlassMail-project/GlassMail/Views/AccountsView.swift").read_text()
models = (ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift").read_text()
worker_index = (ROOT / "platform/cloud-mail/mail-worker/src/index.js").read_text()
gmail_service = (ROOT / "platform/cloud-mail/mail-worker/src/service/gmail-imap-service.js").read_text()
gemini_oauth_service = (ROOT / "platform/cloud-mail/mail-worker/src/service/gemini-oauth-service.js").read_text()
wrangler = (ROOT / "platform/cloud-mail/mail-worker/wrangler.toml").read_text()
inbox = (ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift").read_text()


def require(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")


require('"* * * * *"' in wrangler, "Gmail fallback cron is scheduled every minute")
require("c.cron === '* * * * *'" in worker_index, "Worker scheduled handler accepts the one-minute Gmail cron")
require(re.search(r"GMAIL_AUTO_SYNC_BATCH_SIZE \|\| options\.batchSize,\s*10,\s*1,\s*10", gmail_service), "Worker default Gmail batch covers all currently connected Gmail accounts per scheduled sync")
require(re.search(r"GMAIL_AUTO_SYNC_MESSAGE_LIMIT \|\| options\.limit,\s*50,\s*1,\s*100", gmail_service), "Worker default Gmail scheduled page imports a useful mailbox slice")
require(re.search(r"GMAIL_AUTO_SYNC_ACCOUNT_TIMEOUT_MS \|\| options\.accountTimeoutMs,\s*30000,\s*3000,\s*30000", gmail_service), "Worker default Gmail account timeout allows scheduled import to complete")
require("const CHUNK = 80;" in gmail_service, "Gmail duplicate/cache lookup chunks stay below D1 numbered bind limit")
require("sync_status = 'first_import_failed'" in gmail_service, "Repeated non-auth import failures preserve OAuth and route to import recovery")
require("const authTerminal = info.category === 'auth';" in gmail_service, "Only terminal auth failures route to OAuth reconnect")
require("Gmail OAuth refresh failed:" in gmail_service and "invalid_grant" in gmail_service and "err.category" in gmail_service, "Gmail token refresh failures are classified with provider reason")
require("sync_status = 'mailbox_ready'" in gmail_service and "Gmail evidence promotion check failed" in gmail_service, "Non-auth failures with ledger evidence promote mailbox readiness")
require("last_synced_at = CURRENT_TIMESTAMP" in gmail_service, "Evidence-backed recovery updates Gmail freshness timestamp")
mailbox_lifecycle_body = gmail_service.split("async function mailboxLifecycleAfterImport", 1)[1].split("async function", 1)[0]
require("backfill_done" not in mailbox_lifecycle_body, "Mailbox readiness is based on real ledger evidence, not full historical backfill completion")
require("googleTestUserRequestService.recordAutoApproved" in gemini_oauth_service and "Direct OAuth connect started after CloudMail auto approval." in gemini_oauth_service, "Google OAuth start records CloudMail auto approval before external Google redirect")
require("googleTestUserRequestService.requestAccess" not in gemini_oauth_service, "Default Google OAuth start must not create a pending approval request")
require(
    "gmailInternalDate" in gmail_service
    and "function receivedDate(parsed, source = {})" in gmail_service
    and "normalizeReceivedDate(detail.internalDate ? new Date(Number(detail.internalDate)).toISOString()" in gmail_service,
    "Gmail API receive time uses Gmail internalDate before header Date fallback",
)
require("const DEFAULT_GOOGLE_MAILBOX_SCOPES = [\n\t'openid',\n\t'email',\n\t'profile',\n\t'https://www.googleapis.com/auth/gmail.readonly',\n\t'https://www.googleapis.com/auth/gmail.send'\n];" in gemini_oauth_service, "Gmail mailbox OAuth scopes use Gmail REST read/send scopes and exclude Gemini/AI scopes")
require("fetchGmailApiRawMessage" not in gmail_service, "Gmail OAuth sync does not call removed raw-message helper")
require("const forward = await ingestGmailApiMessages(c, userId, accountId, account, oauth.access_token, listed);" in gmail_service, "Manual/foreground Gmail OAuth sync uses metadata ingest path")
require("const backfillLimit = Math.min(Math.max(Number(params.backfillLimit || 10), 0), Math.min(limit, 25));" in gmail_service, "Gmail OAuth sync advances bounded historical backfill every run")
require("!account.backfill_done && backfillLimit > 0" in gmail_service, "Gmail OAuth backfill is not blocked by forward-sync activity")
require("import googleTestUserRequestService from './google-test-user-request-service';" in gmail_service, "Gmail sync service owns governance first-sync recording for cron and manual paths")
require("await googleTestUserRequestService.recordFirstSync(c, account.email);" in gmail_service, "Successful Gmail sync records first-sync completion in governance")
request_service = (ROOT / "platform/cloud-mail/mail-worker/src/service/google-test-user-request-service.js").read_text()
require("WHEN status = 'oauth_success' AND ?1 IN ('approved_waiting_google_sync', 'google_synced') THEN status" in request_service, "Approval Center cannot downgrade OAuth success")
require("SET status = 'google_synced'," in request_service, "Google synced marking closes the post-OAuth sync lifecycle")
require(re.search(r"SET status = 'google_synced',\s*first_sync_at", request_service), "First sync completion records Gmail REST sync closure")
require("'first_import_failed'" in (ROOT / "platform/cloud-mail/mail-worker/src/service/cloudmail-v2-service.js").read_text(), "Capability contract treats first_import_failed as import recovery")
require("let targets: [MailAddress]" in app_state and "targets = gmailAccounts" in app_state, "iOS foreground refresh syncs all eligible Gmail accounts")
require("withTaskGroup(of: (Int, Result<GmailSyncResponse, Error>).self)" in app_state, "iOS foreground Gmail refresh syncs Gmail accounts concurrently in bounded batches")
require("backend.syncGmail(accountId: account.accountId, limit: 50)" in app_state, "iOS foreground Gmail refresh imports a larger Gmail page")
require("backend.syncGmail(accountId: accountId, limit: 100)" in app_state, "manual Gmail sync imports a deep Gmail page")
require("isForegroundSyncEligibleGmailAccount" in app_state and "legacy_imap_unsupported" in app_state, "legacy IMAP Gmail is excluded from false foreground sync success")
require("openURL(url)" in accounts_view and "startGoogleMailboxOAuth(email: account.email, accountId: account.accountId)" in accounts_view, "Accounts reconnect launches Google OAuth with current mailbox accountId")
require("requiresGoogleOAuthReconnect" in accounts_view and "Reconnect with Google" in accounts_view, "Accounts UI exposes Google reconnect instead of add-account for legacy Gmail")
require('case "needs_reconnect", "legacy_imap_unsupported": return "Reconnect Required"' in models, "Gmail lifecycle status labels reconnect-required states")
require('case "first_import_failed": return "Import Recovery Required"' in models, "Gmail import failure status labels import recovery")
require("sortEmailsByReceivedTime" in inbox and "InboxSmartGroup" in inbox, "All Mail and smart groups preserve newest-received-first ordering")

print("PASS: Gmail realtime sync, reconnect, lifecycle, freshness, and All Mail ordering guard passed.")
