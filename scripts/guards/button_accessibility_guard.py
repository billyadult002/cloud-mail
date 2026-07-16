#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
COPILOT = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailAICopilotView.swift"
REPORT = ROOT / "BUTTON_ACCESSIBILITY_TAP_TARGET_REPORT.md"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("BUTTON_ACCESSIBILITY_GUARD")
    detail = DETAIL.read_text()
    copilot = COPILOT.read_text()
    for label in ["Star message", "Unstar message", "Archive message", "Message actions", "Dismiss action result"]:
        require(label in detail, f"{label} accessibility label exists")
    for label in ["Reply", "Forward", "AI Actions"]:
        require(label in detail, f"{label} bottom action label exists")
    require("role: .destructive" in detail, "destructive actions are differentiated")
    require(".help(" in detail or ".help(" in copilot, "disabled/action help text exists")
    require("frame(minWidth: 92)" in copilot, "AI copilot buttons keep usable tap width")
    require(REPORT.exists(), "button accessibility report exists")
    print("SUCCESS: button accessibility guard passed.")


if __name__ == "__main__":
    main()
