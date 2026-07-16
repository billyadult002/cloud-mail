#!/usr/bin/env python3
"""Guard Cloud AI processing toggle behavior and inline reason text."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
SETTINGS = ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        print(f"FAIL: {message}")
        sys.exit(1)
    print(f"PASS: {message}")


def main() -> None:
    ai_view = AI_VIEW.read_text(encoding="utf-8")
    settings = SETTINGS.read_text(encoding="utf-8")
    app_state = APP_STATE.read_text(encoding="utf-8")

    print("AI_CLOUD_PROCESSING_TOGGLE_GUARD")
    require('Toggle("Allow Cloud AI processing"' in ai_view, "AI Center Cloud AI toggle exists")
    require("consent.cloudAIEnabled = value" in ai_view, "AI Center Cloud AI toggle writes requested value")
    require("Task { await app.saveAIConsent(consent) }" in ai_view, "AI Center Cloud AI toggle persists through AppState")
    require("cloudAIProcessingHelperText" in ai_view, "AI Center shows inline cloud processing reason")
    require("Connect Gemini first." in ai_view, "missing Gemini auth reason is visible")
    require("Connected. Enable Cloud AI processing to run Gemini actions." in ai_view, "connected pending consent reason is visible")
    require("Run Gemini Safe Test before enabling cloud AI processing actions." in ai_view, "Gemini smoke-required reason is visible")
    require("settingsCloudAIHelperText" in settings, "Settings shows matching cloud AI helper")
    require("@Published var aiConsentStatusMessage" in app_state, "AppState exposes consent persistence status")
    print("SUCCESS: Cloud AI processing toggle guard passed.")


if __name__ == "__main__":
    main()
