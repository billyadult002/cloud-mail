#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
MODELS = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"
INBOX = ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    app = APP.read_text(encoding="utf-8")
    models = MODELS.read_text(encoding="utf-8")
    inbox = INBOX.read_text(encoding="utf-8")
    print("ATTACHMENT_SEND_PROVIDER_ACCEPTED_GUARD")
    require("attachments: sendAttachments.map(\\.sendMetadata)" in app, "send request includes attachment payload metadata")
    require("uploadingAttachment" in app and "Uploading attachments..." in app, "attachment sends expose uploading state")
    require("case .providerAccepted" in app and "acceptedByProviderForSendUX" in app, "provider accepted is treated as accepted for send UX")
    require("Provider accepted. Delivery is not confirmed" in app, "send UI preserves provider accepted is not delivered")
    require("case providerAccepted" in models and "case delivered" in models, "provider accepted and delivered are separate model states")
    require("Provider accepted; delivery not confirmed" in inbox, "ledger UI does not label provider accepted as delivered")
    print("SUCCESS: Attachment send provider accepted guard passed.")


if __name__ == "__main__":
    main()
