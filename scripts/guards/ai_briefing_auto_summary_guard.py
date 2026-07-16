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
    print("AI_BRIEFING_AUTO_SUMMARY_GUARD")
    require("runBriefingIfAvailable(force: false)" in text, "AI Briefing auto-starts on email open")
    require("briefingAutoRunKey" in text and "appleBriefingCacheKey" in text, "AI Briefing has stable cache key")
    require("if !force, briefingAutoRunKey == autoRunKey { return }" in text, "AI Briefing avoids redraw reruns")
    require("isBriefingExpanded = true" in text, "AI Briefing expands when running/ready")
    print("SUCCESS: AI Briefing auto summary guard passed.")


if __name__ == "__main__":
    main()
