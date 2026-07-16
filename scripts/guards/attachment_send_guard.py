#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift"
APP = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
MODELS = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    compose = COMPOSE.read_text(encoding="utf-8")
    app = APP.read_text(encoding="utf-8")
    models = MODELS.read_text(encoding="utf-8")
    print("ATTACHMENT_SEND_GUARD")
    require("fileImporter" in compose and "importAttachments(from:" in compose, "Compose can add attachments")
    require("Text(attachment.filename)" in compose, "Attachment chip shows filename")
    require("attachment.mimeType" in compose and "attachment.sizeLabel" in compose, "Attachment chip shows MIME type and size")
    require("attachments: sendAttachments.map(\\.sendMetadata)" in app, "Send request includes attachment metadata")
    require("contentBase64" in models and "contentType: mimeType" in models, "Attachment payload includes base64 content and MIME type")
    require("let initialState: DeliveryState = sendAttachments.isEmpty ? .validating : .uploadingAttachment" in app and "Uploading attachments..." in app, "Attachment sends expose uploading state")
    print("SUCCESS: Attachment send guard passed.")


if __name__ == "__main__":
    main()
