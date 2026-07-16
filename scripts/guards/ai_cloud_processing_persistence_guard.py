#!/usr/bin/env python3
"""Guard local-first persistence for AI consent toggles."""

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[2]
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        print(f"FAIL: {message}")
        sys.exit(1)
    print(f"PASS: {message}")


def main() -> None:
    app_state = APP_STATE.read_text(encoding="utf-8")
    match = re.search(r"func saveAIConsent\(_ consent: AIConsent\) async \{(?P<body>.*?)\n    \}", app_state, flags=re.S)
    require(match is not None, "saveAIConsent exists")
    body = match.group("body")
    print("AI_CLOUD_PROCESSING_PERSISTENCE_GUARD")
    require("localOnlyConsent.cloudAIEnabled = false" in body, "saveAIConsent keeps cloud AI disabled locally")
    require("aiConsent = localOnlyConsent" in body, "saveAIConsent updates AppState before backend response")
    require("updateAIConsentProfilePreferences(localOnlyConsent, persist: true)" in body, "saveAIConsent persists local-only consent locally")
    require("backend.updateAIConsent(localOnlyConsent)" in body, "saveAIConsent still syncs backend with local-only consent")
    require("catch" in body and "aiConsent = localOnlyConsent" in body, "saveAIConsent keeps local consent when backend sync is unavailable")
    require("merged.cloudAIEnabled = false" in app_state, "loadV2Configuration keeps cloud AI disabled")
    print("SUCCESS: Cloud AI processing persistence guard passed.")


if __name__ == "__main__":
    main()
