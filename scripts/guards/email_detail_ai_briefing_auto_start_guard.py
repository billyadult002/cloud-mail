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
    print("EMAIL_DETAIL_AI_BRIEFING_AUTO_START_GUARD")
    require("runBriefing(source: .auto, force: false)" in text, "email open auto-starts briefing")
    require("briefingAutoRunKey" in text and "appleBriefingCacheKey" in text, "auto-start has stable key")
    require("if !force, briefingState.hasSuccessForCurrentBody { return }" in text, "auto-start skips only successful current result")
    require("if !force, briefingAutoRunKey == autoRunKey { return }" in text, "auto-start avoids redraw repeat")
    require("writeBriefingSuccess(cached, source: source)" in text, "cached success writes visible state")
    print("SUCCESS: Email Detail AI Briefing auto-start guard passed.")


if __name__ == "__main__":
    main()
