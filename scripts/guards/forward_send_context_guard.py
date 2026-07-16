#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
COMPOSE = ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    detail = DETAIL.read_text(encoding="utf-8")
    compose = COMPOSE.read_text(encoding="utf-8")
    print("FORWARD_SEND_CONTEXT_GUARD")
    require("startForward()" in detail and "EmailComposeLaunchView" not in detail, "Forward opens compose directly with current email")
    require("recipient = \"\"" in compose, "Forward starts with empty recipient")
    require('subject = s.lowercased().hasPrefix("fwd:") ? s : "Fwd: \\(s)"' in compose, "Forward fills Fwd subject")
    require("----- Forwarded Message -----" in compose, "Forward includes forwarded body")
    require('original == nil ? "New message" : (isForward ? "Forward" : "Reply")' in compose, "Forward compose title is correct")
    print("SUCCESS: Forward send context guard passed.")


if __name__ == "__main__":
    main()
