#!/usr/bin/env python3
"""Guard Gemini connected-to-usable smoke path."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        print(f"FAIL: {message}")
        sys.exit(1)
    print(f"PASS: {message}")


def main() -> None:
    ai_view = AI_VIEW.read_text(encoding="utf-8")
    app_state = APP_STATE.read_text(encoding="utf-8")
    provider = PROVIDER.read_text(encoding="utf-8")

    print("GEMINI_CONNECTED_TO_USABLE_GUARD")
    require("runGeminiSafeTestFromCard" in ai_view, "Gemini card exposes safe test action")
    require('Label("Run Gemini Safe Test"' in ai_view, "Gemini safe test button is visible")
    require("provider.status == .connected && app.aiConsent.aiEnabled && app.aiConsent.cloudAIEnabled" in ai_view, "Gemini safe test can run when connected and consent is on")
    require("provider.action_picker_enabled" in ai_view, "real provider actions still use action enabled state")
    require("app.runSafeProviderAction(providerID: .gemini, action: .summarize)" in ai_view, "Gemini safe test uses shared safe action")
    require('status: passed ? "PASS" : "FAIL"' in app_state, "Gemini smoke writes PASS/FAIL")
    require('safe_user_action_available: (usableNow && status == .connected && smokeResult?.status == "PASS")' in provider, "Gemini usable requires connected and PASS smoke")
    require("Gemini safe synthetic smoke passed" in ai_view, "Gemini PASS message is visible")
    print("SUCCESS: Gemini connected-to-usable guard passed.")


if __name__ == "__main__":
    main()
