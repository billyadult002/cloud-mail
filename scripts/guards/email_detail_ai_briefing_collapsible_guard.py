#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    text = DETAIL.read_text(encoding="utf-8")
    print("EMAIL_DETAIL_AI_BRIEFING_SUMMARIZE_ONLY_GUARD")
    require("private var briefingSummarySurface" in text, "Summarize surface exists")
    require('Label("Summarize", systemImage: "text.bubble")' in text, "Summarize label is visible")
    require('Label("AI Briefing", systemImage: "sparkles")' in text, "AI Briefing header is still visible")
    require('Text(effectiveBriefingExpanded ? "Hide" : "Details")' not in text, "AI Briefing Details/Hide option is removed")
    require('"Details"' not in text[text.find("private var aiCard"):text.find("private var briefingSummarySurface")], "AI Briefing card has no details text")
    require("toggleBriefingDetails" not in text, "AI Briefing details toggle function is removed")
    require("effectiveBriefingExpanded" not in text, "AI Briefing expanded computed state is removed")
    require("setBriefingExpanded" not in text, "AI Briefing expanded persistence writer is removed")
    require("expandedBriefingEmailIDs" not in text, "AI Briefing expanded persistence storage is removed")
    require("aiTruthLayer" not in text, "AI Briefing readiness/authorization/privacy detail layer is removed")
    require("briefingResultControls" not in text, "AI Briefing provider/copy/refresh detail controls are removed")
    require("-CloudMailBriefingExpanded" not in text, "AI Briefing debug expanded launch hook is removed")
    require("-CloudMailBriefingAutoTapAfterAppear" not in text, "AI Briefing debug auto-tap hook is removed")
    require("isExpanded: false" in text, "AI Briefing state machine records no expanded detail UI")
    print("SUCCESS: Email Detail AI Briefing summarize-only guard passed.")


if __name__ == "__main__":
    main()
