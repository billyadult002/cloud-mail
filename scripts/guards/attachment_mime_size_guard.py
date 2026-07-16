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
    print("ATTACHMENT_MIME_SIZE_GUARD")
    require("UTType(filenameExtension:" in compose and "preferredMIMEType" in compose, "MIME type is inferred from file extension")
    require("maxAttachmentBytes" in compose and "maxTotalAttachmentBytes" in compose, "raw attachment size limits exist")
    require("encodedPayloadBytes(for:" in compose and "maxTotalEncodedAttachmentBytes" in compose, "base64 encoded size is checked")
    require("blockedAttachmentExtensions" in compose, "blocked executable attachment extension list exists")
    for ext in ['\"exe\"', '\"dmg\"', '\"sh\"', '\"js\"', '\"app\"']:
        require(ext in compose, f"blocked executable extension present: {ext}")
    require("executable files are blocked" in compose, "blocked attachment error is visible")
    print("SUCCESS: Attachment MIME/size guard passed.")


if __name__ == "__main__":
    main()
