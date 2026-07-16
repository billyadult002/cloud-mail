#!/usr/bin/env python3
"""Guard unified account capability contract and receive-only truth."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
ACCOUNTS_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AccountsView.swift"
INBOX_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift"
COMPOSE = ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift"
SETTINGS = ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift"
WORKER = ROOT / "platform/cloud-mail/mail-worker/src/service/cloudmail-v2-service.js"
EMAIL = ROOT / "platform/cloud-mail/mail-worker/src/service/email-service.js"


def require(condition: bool, message: str) -> None:
    if not condition:
        print(f"FAIL: {message}")
        sys.exit(1)
    print(f"PASS: {message}")


def main() -> None:
    models = MODELS.read_text(encoding="utf-8")
    app = APP_STATE.read_text(encoding="utf-8")
    accounts = ACCOUNTS_VIEW.read_text(encoding="utf-8")
    inbox = INBOX_VIEW.read_text(encoding="utf-8")
    compose = COMPOSE.read_text(encoding="utf-8")
    settings = SETTINGS.read_text(encoding="utf-8")
    worker = WORKER.read_text(encoding="utf-8")
    email = EMAIL.read_text(encoding="utf-8")
    combined_ui = accounts + inbox + compose + settings

    print("ACCOUNT_CAPABILITY_RECEIVE_ONLY_GUARD")
    require("struct AccountCapabilityContract" in models, "shared account capability contract exists")
    for marker in [
        "accountID", "providerType", "accountOwnershipType", "authType",
        "tokenReferencePresent", "sendScopePresent", "receiveScopePresent",
        "providerSendSupported", "providerReceiveSupported", "delegatedAuthorization",
        "restoredFromAuthorization", "capabilityHydratedAt", "mailboxLifecycleState", "mailboxReady", "canReceive", "canSend",
        "sendUnavailableReason", "receiveUnavailableReason", "accountHealth",
        "uiSendStatus", "backendSendEligibility", "composeEnabled"
    ]:
        require(marker in models, f"capability contract field present: {marker}")
    require("JSONSerialization.jsonObject" in models, "capabilities JSON is parsed structurally")
    require('"account_ownership_type":"OWNED"' in worker, "owned account capability metadata is emitted")
    require('"mailbox_lifecycle_state":"MAILBOX_READY"' in worker and "sync_status = 'mailbox_ready'" in worker, "owned Gmail/Workspace send only after mailbox ready")
    require("provider = 'cloudflare_native'" in worker and '"send":true' in worker, "CloudMail native send true")
    require('"account_ownership_type":"DELEGATED"' in worker and '"delegated_send_authorized":false' in worker, "unauthorized delegated receive-only remains explicit")
    require('"delegated_send_authorized":true' in worker and "authorization_method = 'owner_password'" in worker, "owner-password delegated send is explicit")
    require("send_scope_missing" in worker + models, "missing send scope path exists")
    require("Reconnect required for send" in models + app + email, "missing send scope explains reconnect")
    require("Capability refresh required" in models, "missing metadata does not collapse to receive-only")
    require("identity.canSend ? \"Can send\" : identity.sendStatusReason" in inbox + settings, "Inbox/Settings use capability reason")
    require("account.canSend ? \"Can send\" : account.sendStatusReason" in accounts, "Account Center uses capability reason")
    require("app.canSend(from: address)" in compose, "Compose follows AppState capability")
    require("accountRow.userId !== userId" in email, "backend owner check preserved")
    require("sendCapableProviders" in email and "send_scope_missing" in email, "backend send eligibility matches capability")
    require("ProviderAccepted != Delivered" not in worker + email, "no false Delivered claim text added")
    print("SUCCESS: account capability receive-only guard passed.")


if __name__ == "__main__":
    main()
