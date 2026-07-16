#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
AI = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
COMPOSE = ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift"
REPORT = ROOT / "ACTION_RESULT_SURFACE_REPORT.md"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("ACTION_RESULT_SURFACE_GUARD")
    detail = DETAIL.read_text()
    ai = AI.read_text()
    compose = COMPOSE.read_text()
    require("actionResultCard" in detail, "Email Detail has result card")
    require("translationResultCard" in detail, "Translate has result card")
    require("ProgressView()" in detail and "isTranslating" in detail, "Translate has loading surface")
    require("showCompose = true" in detail, "Reply/forward destination exists")
    require("safeActionResult" in ai and "AIActionResultView" in ai, "AI safe tests show result view")
    require("aiSuggestionPreview" in compose and "localError" in compose, "Compose AI/send actions have result/error surfaces")
    require(REPORT.exists(), "action result surface report exists")
    print("SUCCESS: action result surface guard passed.")


if __name__ == "__main__":
    main()
