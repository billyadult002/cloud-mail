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
    print("REAL_SEND_PLAIN_TEXT_GUARD")
    require("private var canSend" in compose, "Compose has a single send gate")
    require("configureDefaultFromIfNeeded()" in compose and ".onChange(of: app.composeFromAddresses.map(\\.email))" in compose, "Compose selects From after async account load")
    require("app.canSend(from: fromAddress)" in compose, "Send gate requires selected From canSend")
    require(".disabled(!canSend || isSending)" in compose, "Send button is disabled unless canSend")
    require("isValidEmailList(recipient)" in compose, "Send gate validates recipients")
    require("!messageBody.trimmingCharacters" in compose, "Send gate requires body text")
    require("DeliveryState" in models and "case sending" in models and "case providerAccepted" in models, "delivery state model includes sending/provider accepted")
    require("deliveryState = .sending" in app and "Sending message..." in app, "outbox records sending state")
    require("backend.send(form)" in app, "send path calls backend send")
    require("Provider accepted. Delivery is not confirmed" in compose + app, "provider accepted is surfaced without delivery claim")
    print("SUCCESS: Real send plain text guard passed.")


if __name__ == "__main__":
    main()
