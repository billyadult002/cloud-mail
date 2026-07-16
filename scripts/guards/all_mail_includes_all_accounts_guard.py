#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
EMAIL_SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/email-service.js"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


print("ALL_MAIL_INCLUDES_ALL_ACCOUNTS_GUARD")
app = APP.read_text(encoding="utf-8")
email_service = EMAIL_SERVICE.read_text(encoding="utf-8")
require("globalMailLedger" in app or "loadMailPage" in app, "iOS requests the Global Message Ledger for All Mail")
require("accountScopeCondition" in email_service, "backend centralizes account scope for list queries")
require("allReceiveMailboxScopeCondition" in email_service, "backend uses an all-account scope helper")
require("globalLedgerList" in email_service, "backend exposes canonical all-account Global Message Ledger")
require("allReceive ? eq(1,1) : eq(email.accountId, accountId)" not in email_service, "backend no longer uses unrestricted current-user-only allReceive account bypass")
print("SUCCESS: All Mail includes all accounts guard passed.")
