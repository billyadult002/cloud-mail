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
    print("EMAIL_DETAIL_AI_ACTIONS_SUMMARIZE_RESULT_GUARD")
    require('Label("Summarize", systemImage: "text.bubble.fill")' in text, "AI Actions Summarize exists")
    require("Button { runBriefing(source: .generateButton, force: true) }" in text, "AI Actions Summarize uses briefing runner")
    require("writeBriefingSuccess(triage, source: source)" in text, "Summarize writes briefing result surface")
    require("briefingState.resultText" in text, "result surface reads authoritative briefing result text")
    print("SUCCESS: Email Detail AI Actions Summarize result guard passed.")


if __name__ == "__main__":
    main()
