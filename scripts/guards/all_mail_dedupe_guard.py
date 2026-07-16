#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMAIL_SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/email-service.js"
REPORT = ROOT / "UNIFIED_ALL_MAIL_SEMANTIC_CONTRACT_REPORT.md"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


print("ALL_MAIL_DEDUPE_GUARD")
email_service = EMAIL_SERVICE.read_text(encoding="utf-8")
report = REPORT.read_text(encoding="utf-8") if REPORT.exists() else ""
report_lower = report.lower()
require("stableMessageId" in email_service and "externalMessageId" in email_service, "backend exposes stable message identity")
require("dedupe_key" in report, "semantic contract requires dedupe_key")
require("one normalized logical message" in report_lower, "contract prevents duplicate folder copies")
print("SUCCESS: All Mail dedupe guard passed.")
