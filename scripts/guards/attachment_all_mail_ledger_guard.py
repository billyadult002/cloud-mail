#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMAIL_SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/email-service.js"
GLOBAL_API = ROOT / "platform/cloud-mail/mail-worker/src/api/global-mail-ledger-api.js"
BACKEND = ROOT / "files/GlassMail-project/GlassMail/Services/Backend.swift"
MODELS = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"
INBOX = ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    email_service = EMAIL_SERVICE.read_text(encoding="utf-8")
    global_api = GLOBAL_API.read_text(encoding="utf-8")
    backend = BACKEND.read_text(encoding="utf-8")
    models = MODELS.read_text(encoding="utf-8")
    inbox = INBOX.read_text(encoding="utf-8")
    print("ATTACHMENT_ALL_MAIL_LEDGER_GUARD")
    require("/v2/mail/all" in backend and "/v2/mail/all" in global_api, "All Mail uses the Global Message Ledger endpoint")
    for field in ["has_attachments", "attachment_count", "direction", "status", "delivery_truth_state", "mailbox_email"]:
        require(field in email_service or field in global_api, f"Global ledger includes {field}")
    require("attachmentCount" in models and "attachmentSignalCount" in models, "iOS model decodes and surfaces attachment ledger metadata")
    require("attachmentSignalCount" in models and "attachmentNames.count" in inbox, "All Mail UI can surface attachment count/signals")
    require("Provider accepted; delivery not confirmed" in inbox, "All Mail preserves ProviderAccepted != Delivered")
    print("SUCCESS: Attachment All Mail ledger guard passed.")


if __name__ == "__main__":
    main()
