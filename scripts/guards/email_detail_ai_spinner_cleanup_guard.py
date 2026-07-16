#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"


def require(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    text = EMAIL.read_text()
    print("EMAIL_DETAIL_AI_SPINNER_CLEANUP_GUARD")
    require("isBriefingRunning" in text, "bottom spinner reads briefing-specific running state")
    require("startBriefingSlowWarning" in text, "5-second slow warning task exists")
    require("Still generating briefing..." in text, "slow warning text exists")
    require("cancelBriefingSlowWarning()" in text, "slow warning clears on completion/cancel")
    require("currentBriefingTask = nil" in text, "briefing task clears")
    require("cancelBriefingAction" in text, "briefing cancel path exists")
    print("SUCCESS: Email Detail AI spinner cleanup guard passed.")


if __name__ == "__main__":
    main()
