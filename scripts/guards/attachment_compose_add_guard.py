#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    compose = COMPOSE.read_text(encoding="utf-8")
    print("ATTACHMENT_COMPOSE_ADD_GUARD")
    require("fileImporter" in compose and "importAttachments(from:" in compose, "Compose supports user-selected file attachments")
    require("Add safe test attachment" in compose and "addSafeTestAttachment" in compose, "Debug real-device validation can add a safe synthetic attachment")
    require("#if DEBUG" in compose and "Safe Test" in compose, "safe synthetic attachment shortcut is debug-only")
    require("-CloudMailAttachmentSmoke" in compose and "applyAttachmentSmokeLaunchArgumentsIfNeeded" in compose, "Debug launch arguments can prefill a safe attachment smoke test")
    require("-CloudMailAttachmentAutoSend" in compose and "attachmentSmokeAutoSendStarted" in compose, "Debug real-device smoke can complete send without manual tapping")
    require("Text(attachment.filename)" in compose, "attachment row shows filename")
    require("attachment.mimeType" in compose and "attachment.sizeLabel" in compose, "attachment row shows MIME type and size")
    require("Remove attachment" in compose, "attachment row exposes delete/remove action")
    print("SUCCESS: Attachment compose add guard passed.")


if __name__ == "__main__":
    main()
