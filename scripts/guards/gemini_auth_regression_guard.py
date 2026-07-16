#!/usr/bin/env python3
"""Guard Gemini OAuth against UI-side auth regression."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)
    print(f"PASS: {message}")


def main() -> None:
    ai_view = AI_VIEW.read_text(encoding="utf-8")
    app_state = APP_STATE.read_text(encoding="utf-8")
    provider = PROVIDER.read_text(encoding="utf-8")
    combined = "\n".join([ai_view, app_state, provider])

    print("GEMINI_AUTH_REGRESSION_GUARD")
    require("Try Google Sign-In" in ai_view, "Gemini OAuth CTA is present")
    require("await app.startGeminiOAuth()" in ai_view, "Gemini CTA calls startGeminiOAuth")
    require("openURL(url)" in ai_view, "Gemini CTA opens authorization URL")
    require("oauth_retry_enabled" in provider, "Gemini registry records retry-enabled OAuth")
    require("geminiOAuthStatus?.authorized == true" in provider, "Gemini connected state still comes from OAuth status")
    for forbidden in ["OAuth blocked (403)", "Google tester access required", "localError = geminiOAuth403Message"]:
        require(forbidden not in ai_view, f"Gemini UI no longer hard-blocks login with: {forbidden}")
    require("Gemini is blocked by Google OAuth Error 403" in app_state, "runtime blocked message remains honest if OAuth not authorized")
    print("SUCCESS: Gemini auth regression guard passed.")


if __name__ == "__main__":
    main()
