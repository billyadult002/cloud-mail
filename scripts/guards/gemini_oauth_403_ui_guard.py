#!/usr/bin/env python3
"""Guard that Gemini UI reflects the observed Google OAuth 403 blocker."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2]
AI_PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
SETTINGS = ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)
    print(f"PASS: {message}")


def main() -> None:
    provider = AI_PROVIDER.read_text(encoding="utf-8")
    ui = AI_VIEW.read_text(encoding="utf-8")
    settings = SETTINGS.read_text(encoding="utf-8")
    app_state = APP_STATE.read_text(encoding="utf-8")
    combined = "\n".join([provider, ui, settings, app_state])

    print("GEMINI_OAUTH_403_UI_GUARD")
    for snippet in [
        "oauth_retry_enabled",
        "google_oauth_access_denied_if_google_console_not_ready",
        "Error 403",
        "confirm this Google account is approved in the OAuth test-user list",
        "Try Google Sign-In",
        "Authorization required",
        "retry_oauth_or_confirm_google_oauth_test_user_or_complete_google_verification",
    ]:
        require(snippet in combined, f"Gemini retry/auth evidence present: {snippet}")

    require("billyadult006@gmail.com" not in combined, "hard-coded Google OAuth test-user email removed")
    require("Sign in available" not in ui, "AI workspace no longer claims Gemini sign-in is available")
    require("openURL(url)" in ui, "AI workspace Gemini card can launch OAuth again")
    require("localError = geminiOAuth403Message" not in ui, "Gemini 403 status does not render as bottom red error")
    require("Gemini is blocked by Google OAuth Error 403" in app_state, "runtime error messaging names Gemini 403 blocker")

    print("SUCCESS: Gemini OAuth 403 UI guard passed.")


if __name__ == "__main__":
    main()
