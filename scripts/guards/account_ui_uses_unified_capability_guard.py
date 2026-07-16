#!/usr/bin/env python3
"""Guard Accounts UI uses the unified capability contract."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACCOUNTS = ROOT / "files/GlassMail-project/GlassMail/Views/AccountsView.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
MODELS = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"
WORKER = ROOT / "platform/cloud-mail/mail-worker/src/service/cloudmail-v2-service.js"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> int:
    accounts = ACCOUNTS.read_text(encoding="utf-8")
    app = APP_STATE.read_text(encoding="utf-8")
    models = MODELS.read_text(encoding="utf-8")
    worker = WORKER.read_text(encoding="utf-8")
    print("ACCOUNT_UI_USES_UNIFIED_CAPABILITY_GUARD")
    require("account.canSend" in accounts and "account.sendStatusReason" in accounts, "Accounts UI reads unified capability status")
    require("restoredSendCapability" in app, "AppState centralizes send capability")
    require("accountCapabilityContractV2Json" in models, "iOS decodes backend V2 contract")
    require("delegated_send_authorized" in models + worker, "delegated send requires explicit contract field")
    require("account.provider == .cloudflareNative ? \"Routing active\" : \"Health check pending\"" in accounts, "Account UI separates CloudMail routing from external sync")
    print("SUCCESS: Accounts UI unified capability guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
