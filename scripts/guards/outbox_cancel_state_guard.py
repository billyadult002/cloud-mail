#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
INBOX = ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift"
MODELS = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    app = APP.read_text(encoding="utf-8")
    inbox = INBOX.read_text(encoding="utf-8")
    models = MODELS.read_text(encoding="utf-8")
    print("OUTBOX_CANCEL_STATE_GUARD")
    require("case cancelled" in models, "cancelled delivery state exists")
    require("func cancelOutboxMessage" in app, "outbox cancel state transition exists")
    require("deliveryState = .cancelled" in app and "deliveryState: .cancelled" in app, "cancel records cancelled state")
    require("Cancelled by user. Delivery was not attempted or confirmed." in app, "cancel text avoids Delivered claim")
    require('Label("Cancel", systemImage: "xmark.circle")' in inbox, "Outbox exposes Cancel action")
    require('Label("Delete", systemImage: "trash")' in inbox, "Outbox exposes Delete action")
    require("-CloudMailOutboxCancel" in inbox, "real-device cancel launch hook exists")
    print("SUCCESS: Outbox cancel state guard passed.")


if __name__ == "__main__":
    main()
