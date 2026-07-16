#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INBOX = ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift"
BACKEND = ROOT / "files/GlassMail-project/GlassMail/Services/Backend.swift"
EMAIL_SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/email-service.js"
GLOBAL_API = ROOT / "platform/cloud-mail/mail-worker/src/api/global-mail-ledger-api.js"
REPORT = ROOT / "UNIFIED_ALL_MAIL_SEMANTIC_CONTRACT_REPORT.md"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


print("UNIFIED_ALL_MAIL_CONTRACT_GUARD")
inbox = INBOX.read_text(encoding="utf-8")
backend = BACKEND.read_text(encoding="utf-8")
email_service = EMAIL_SERVICE.read_text(encoding="utf-8")
global_api = GLOBAL_API.read_text(encoding="utf-8") if GLOBAL_API.exists() else ""
report = REPORT.read_text(encoding="utf-8") if REPORT.exists() else ""
require("isMergedAllMailView" in inbox, "iOS has an explicit merged All Mail mode")
require("unifiedLocalLedgerItems" in inbox, "All Mail includes a local lifecycle ledger")
require("/v2/mail/all" in global_api and "globalLedgerList" in global_api, "backend exposes Global Message Ledger endpoint")
require("globalMailLedger" in backend and "/v2/mail/all" in backend, "iOS All Mail consumes Global Message Ledger endpoint")
for field in [
    "message_id", "thread_id", "account_id", "mailbox_email", "provider",
    "direction", "folder", "status", "delivery_truth_state", "dedupe_key"
]:
    require(field in report, f"semantic contract documents {field}")
for field in [
    "message_id", "thread_id", "account_id", "identity_id", "mailbox_email",
    "direction", "folder", "status", "has_attachments", "attachment_count",
    "source_folder", "sync_state", "delivery_truth_state"
]:
    require(field in email_service, f"Global Message Ledger emits {field}")
require("ProviderAccepted does not equal Delivered" in report, "delivery truth boundary documented")
print("SUCCESS: Unified All Mail contract guard passed.")
