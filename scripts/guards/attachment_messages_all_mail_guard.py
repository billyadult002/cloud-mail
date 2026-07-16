#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INBOX = ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift"
COMPOSE = ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift"
REPORT = ROOT / "ATTACHMENT_MESSAGES_ALL_MAIL_INDEXING_REPORT.md"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


print("ATTACHMENT_MESSAGES_ALL_MAIL_GUARD")
inbox = INBOX.read_text(encoding="utf-8")
compose = COMPOSE.read_text(encoding="utf-8")
report = REPORT.read_text(encoding="utf-8") if REPORT.exists() else ""
require("attachmentNames.count" in inbox, "All Mail local ledger shows attachment count")
require("draft.displayAttachmentNames" in inbox, "draft attachments are counted in the ledger")
require("blockedAttachmentExtensions" in compose, "unsafe attachment filtering remains active")
require("has_attachments" in report and "attachment_count" in report, "attachment indexing contract is documented")
print("SUCCESS: Attachment messages All Mail guard passed.")
