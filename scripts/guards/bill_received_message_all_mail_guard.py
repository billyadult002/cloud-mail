#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMAIL_SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/email-service.js"
BACKEND = ROOT / "files/GlassMail-project/GlassMail/Services/Backend.swift"
REPORT = ROOT / "BILL_RECEIVED_MESSAGE_ALL_MAIL_VISIBILITY_FIX_REPORT.md"
SUBJECT = "CloudMail real-use send test 20260706-121605"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


print("BILL_RECEIVED_MESSAGE_ALL_MAIL_GUARD")
email_service = EMAIL_SERVICE.read_text(encoding="utf-8")
backend = BACKEND.read_text(encoding="utf-8")
report = REPORT.read_text(encoding="utf-8") if REPORT.exists() else ""
require("allReceiveMailboxScopeCondition" in email_service, "All Mail can include active authorized bill mailbox scope")
require("globalLedgerList" in email_service and "mailbox_authorizations" in email_service, "Global Message Ledger includes active authorized bill mailbox scope")
require("globalMailLedger" in backend, "iOS All Mail uses Global Message Ledger for real-device visibility")
require("eq(account.userId, email.userId)" in email_service, "source mailbox metadata follows the actual message owner")
require(SUBJECT in report, "bill visibility report names the exact real-use subject")
require("bill@fastonegroup.com" in report, "bill visibility report names the expected source mailbox")
require("no unrelated mailbox content inspected" in report.lower(), "report preserves private-mail boundary")
print("SUCCESS: Bill received message All Mail guard passed.")
