#!/usr/bin/env python3
"""Guard Gemini connected/usable UI preservation while changing ChatGPT broker code."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
AI_VIEW = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Views" / "AIView.swift"
AI_PROVIDER = ROOT / "files" / "GlassMail-project" / "GlassMail" / "AI" / "AIProvider.swift"
APP_STATE = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Services" / "AppState.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")


def main() -> int:
    ai_view = AI_VIEW.read_text()
    ai_provider = AI_PROVIDER.read_text()
    app_state = APP_STATE.read_text()
    require("private var geminiCard" in ai_view, "Gemini AI Center card is missing")
    require("Run Gemini Safe Test" in ai_view, "Gemini safe-test action is missing")
    require("Google OAuth" in ai_view and "Disconnect Gemini" in ai_view, "Gemini OAuth connected UI is missing")
    require("case .gemini:" in ai_provider and "geminiOAuthStatus?.authorized == true" in ai_provider, "Gemini OAuth status mapping changed")
    require("runGeminiSafeTest" in ai_view, "Gemini safe test handler is missing")
    require("providerID == .chatgpt" in app_state and "providerID == .gemini" in app_state, "Provider action routing is incomplete")
    print("PASS: Gemini usable UI and OAuth routing are preserved.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
