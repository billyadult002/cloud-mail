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
    print("EMAIL_DETAIL_AI_BRIEFING_RESULT_CARD_GUARD")
    require("briefingState.phase == .success" in text, "success condition can render")
    require("Text(ProductSafeText.sanitize(resultText, context: .ai))" in text, "result text is rendered")
    require('Label("Provider: Apple Intelligence"' in text, "provider label is rendered")
    require('Label("Copy"' in text, "Copy control exists")
    require('Label("Refresh"' in text, "Refresh control exists")
    require('Label(isBriefingExpanded ? "Collapse" : "Expand"' in text, "Collapse/Expand control exists")
    require('briefingState.phase == .idle && triage == nil' in text, "No briefing text is limited to idle state")
    print("SUCCESS: Email Detail AI Briefing result card guard passed.")


if __name__ == "__main__":
    main()
