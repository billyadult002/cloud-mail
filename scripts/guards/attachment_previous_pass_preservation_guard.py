#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "REAL_USE_ATTACHMENT_SEND_RECEIVE_OPEN_FINAL_REPORT.md"
COMPOSE = ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift"
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    report = REPORT.read_text(encoding="utf-8")
    compose = COMPOSE.read_text(encoding="utf-8")
    detail = DETAIL.read_text(encoding="utf-8")
    print("ATTACHMENT_PREVIOUS_PASS_PRESERVATION_GUARD")
    require("CLOUDMAIL_REAL_USE_ATTACHMENT_SEND_RECEIVE_OPEN_REAL_IPHONE_PASS" in report, "attachment final PASS report preserved")
    require("CloudMail attachment real-use test 20260706-151301" in report, "attachment PASS subject evidence preserved")
    require("cloudmail-attachment-preview-20260706-151301.png" in report, "attachment preview evidence preserved")
    require("-CloudMailAttachmentSmoke" in compose and "-CloudMailAttachmentAutoSend" in compose, "attachment real-device smoke path preserved")
    require("downloadAttachmentFile" in detail, "attachment local download path preserved")
    require("attachmentPreviewItem" in detail and "attachmentShareItem" in detail, "attachment preview/share surfaces preserved")
    require("Provider accepted. Delivery is not confirmed" in report + compose, "attachment send boundary avoids false Delivered")
    print("SUCCESS: Attachment previous PASS preservation guard passed.")


if __name__ == "__main__":
    main()
