#!/usr/bin/env python3
"""Guard Gmail mailbox lifecycle, reconnect identity, and capability truth."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        print(f"FAIL: {message}")
        sys.exit(1)
    print(f"PASS: {message}")


def main() -> int:
    worker = read("platform/cloud-mail/mail-worker/src/service/cloudmail-v2-service.js")
    oauth = read("platform/cloud-mail/mail-worker/src/service/gemini-oauth-service.js")
    gmail = read("platform/cloud-mail/mail-worker/src/service/gmail-imap-service.js")
    backend = read("files/GlassMail-project/GlassMail/Services/Backend.swift")
    app_state = read("files/GlassMail-project/GlassMail/Services/AppState.swift")
    models = read("files/GlassMail-project/GlassMail/Models/Models.swift")
    views = read("files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift")

    print("MAILBOX_LIFECYCLE_TRUTH_GUARD")

    for marker in [
        '"mailbox_lifecycle_state":"LEGACY_IMAP_UNSUPPORTED"',
        '"mailbox_lifecycle_state":"FIRST_IMPORT_PENDING"',
        '"mailbox_lifecycle_state":"MAILBOX_READY"',
        '"mailbox_ready":false',
        '"mailbox_ready":true',
        '"recovery_action":"RECONNECT_OAUTH"',
        '"recovery_action":"RUN_IMPORT_RECOVERY"',
        "MAILBOX_READY_NOT_VERIFIED",
    ]:
        require(marker in worker, f"Worker lifecycle contract marker: {marker}")

    require("provider = 'cloudflare_native'" in worker, "CloudMail native keeps its own ready path")
    require("provider IN ('gmail', 'google_workspace', 'cloudflare_native')" not in worker, "Gmail is not granted legacy provider-default send/read")
    require("WHEN provider IN ('gmail', 'google_workspace') THEN 'pending'" in worker, "Gmail fallback account status is pending until mailbox_ready")

    for marker in [
        "requestedAccountId",
        "archiveDuplicateGoogleMailboxes",
        "reconnect_current_mailbox",
        "external_account_id",
        "first_import_pending",
    ]:
        require(marker in oauth, f"OAuth reconnect identity marker: {marker}")

    for marker in [
        "mailboxLifecycleAfterImport",
        "latestGmailLedgerEvidence",
        "legacy_imap_unsupported",
        "LEGACY_IMAP_UNSUPPORTED_MESSAGE",
    ]:
        require(marker in gmail, f"Gmail lifecycle import marker: {marker}")

    require("accountId: Int? = nil" in backend, "iOS Backend start OAuth accepts optional accountId")
    require('URLQueryItem(name: "accountId"' in backend, "iOS Backend sends reconnect accountId query")
    require("startGoogleMailboxOAuth(email: String = \"\", accountId: Int? = nil)" in app_state, "AppState exposes reconnect-aware OAuth")
    require("startGoogleMailboxOAuth(email: account.email, accountId: account.accountId)" in views, "Recovery UI reconnects current mailbox")

    for marker in [
        "mailboxLifecycleState",
        "mailboxReady",
        "recoveryAction",
        "First Import Pending",
        "Requires Reconnect",
        "Mailbox Ready",
        "mailboxReady && providerStatus == .oauthAuthorized",
    ]:
        require(marker in models + app_state, f"iOS lifecycle truth marker: {marker}")

    print("SUCCESS: Mailbox lifecycle truth guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
