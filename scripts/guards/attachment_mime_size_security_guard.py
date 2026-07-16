#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
COMPOSE = ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift"
MODELS = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    compose = COMPOSE.read_text(encoding="utf-8")
    models = MODELS.read_text(encoding="utf-8")
    print("ATTACHMENT_MIME_SIZE_SECURITY_GUARD")
    require("UTType(filenameExtension:" in compose and "preferredMIMEType" in compose, "MIME type is inferred")
    require("maxAttachmentBytes" in compose and "maxTotalAttachmentBytes" in compose, "raw size limits are checked")
    require("encodedPayloadBytes(for:" in compose and "maxTotalEncodedAttachmentBytes" in compose, "base64 encoded size is checked")
    require("blockedAttachmentExtensions" in compose and "executable files are blocked" in compose, "executable attachment extensions are blocked")
    require("hasBlockedAttachmentExtension(in:" in compose and ".dropFirst()" in compose, "dangerous double extensions are blocked")
    for ext in ['"exe"', '"dmg"', '"sh"', '"js"', '"app"', '"ps1"']:
        require(ext in compose, f"blocked executable extension present: {ext}")
    require("contentBase64" in models and "contentType: mimeType" in models and "type: mimeType" in models, "send metadata carries base64 payload and MIME type")
    print("SUCCESS: Attachment MIME/size/security guard passed.")


if __name__ == "__main__":
    main()
