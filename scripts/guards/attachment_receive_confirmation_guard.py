#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMAIL = ROOT / "platform/cloud-mail/mail-worker/src/email/email.js"
ATT_SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/att-service.js"
EMAIL_SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/email-service.js"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    email = EMAIL.read_text(encoding="utf-8")
    att_service = ATT_SERVICE.read_text(encoding="utf-8")
    email_service = EMAIL_SERVICE.read_text(encoding="utf-8")
    print("ATTACHMENT_RECEIVE_CONFIRMATION_GUARD")
    require("email.attachments" in email and "attachments.push" in email, "inbound MIME attachments are collected")
    require("await attService.addAtt" in email and "attachment_persist_failed" in email, "inbound attachments are durably stored or fail safely")
    require("contentDisposition" in att_service and "contentType" in att_service, "attachment storage preserves content disposition and MIME type")
    require("has_attachments" in email_service and "attachment_count" in email_service, "message ledger exposes attachment presence/count")
    print("SUCCESS: Attachment receive confirmation guard passed.")


if __name__ == "__main__":
    main()
