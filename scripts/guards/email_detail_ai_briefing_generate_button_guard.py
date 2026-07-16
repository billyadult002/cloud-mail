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
    print("EMAIL_DETAIL_AI_BRIEFING_GENERATE_BUTTON_GUARD")
    require("runBriefing(source: .generateButton, force: true)" in text, "Generate button forces briefing runner")
    require("currentBriefingTask?.cancel()" in text, "Generate path can cancel stale briefing task")
    require("await app.triageLocalStrict(displayedEmail, force: force)" in text, "Generate path calls Apple local summary runner")
    require("writeBriefingSuccess(triage, source: source)" in text, "Generate success writes visible briefing result")
    require("briefingState.errorMessage = failure.message" in text, "Generate failure writes inline error")
    print("SUCCESS: Email Detail AI Briefing Generate button guard passed.")


if __name__ == "__main__":
    main()
