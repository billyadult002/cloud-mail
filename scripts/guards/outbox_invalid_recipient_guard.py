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
    print("OUTBOX_INVALID_RECIPIENT_GUARD")
    require("-CloudMailInvalidRecipientSmoke" in compose, "real-device invalid recipient smoke launch hook exists")
    require('recipient = "invalid-recipient"' in compose, "invalid recipient is synthetic and non-private")
    require("CloudMail safe invalid recipient test. No private data." in compose, "invalid recipient body is safe synthetic content")
    require("Add at least one valid recipient." in compose, "invalid recipient shows local validation error")
    require(".disabled(!canSend || isSending)" in compose, "send button remains disabled while invalid or sending")
    print("SUCCESS: Outbox invalid recipient guard passed.")


if __name__ == "__main__":
    main()
