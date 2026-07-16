#!/usr/bin/env python3
"""Guard Gemini usable state so authenticated smoke is required."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
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
    app_state = APP_STATE.read_text(encoding="utf-8")
    provider = PROVIDER.read_text(encoding="utf-8")
    print("GEMINI_AUTHENTICATED_SMOKE_GUARD")
    require("runGeminiSafeProviderTest()" in app_state, "Gemini safe provider test exists")
    require("providerID == .chatgpt" in app_state, "ChatGPT broker path is separate from Gemini")
    require("let result = await aiWorkspaceSyntheticAction(action)" in app_state, "Gemini still uses authenticated backend workspace action")
    require("aiProviderUsability[providerID] = passed" in app_state, "Gemini usability follows smoke result")
    require('safe_user_action_available: (usableNow && status == .connected && smokeResult?.status == "PASS")' in provider, "Gemini usable action requires smoke PASS")
    print("SUCCESS: Gemini authenticated smoke guard passed.")


if __name__ == "__main__":
    main()
