#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMAIL_DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"


def require(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    text = EMAIL_DETAIL.read_text()
    print("AI_BUTTON_TIMEOUT_CANCEL_GUARD")
    require("cancelCurrentAIAction" in text, "Cancel action exists")
    require("retryAIAction" in text, "Retry action exists")
    require(".disabled(!canGenerateBriefing || aiActionPhase.isRunning)" in text, "duplicate AI taps disabled")
    require(".timeout(" in text and ".failure(" in text, "timeout and failure surfaces exist")
    print("SUCCESS: AI button timeout/cancel guard passed.")


if __name__ == "__main__":
    main()
