#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("EMAIL_DETAIL_STAR_BUTTON_GUARD")
    detail = DETAIL.read_text()
    require("toggleStarAction()" in detail, "toolbar star invokes a handler")
    require("localStarred = next" in detail, "star handler updates local visible state")
    require("app.setStar(displayedEmail, starred: next)" in detail, "star handler persists through AppState")
    require("Message starred." in detail and "Message unstarred." in detail, "star handler surfaces feedback")
    require("Unstar message" in detail and "Star message" in detail, "star button has stateful accessibility label")
    print("SUCCESS: email detail star button guard passed.")


if __name__ == "__main__":
    main()
