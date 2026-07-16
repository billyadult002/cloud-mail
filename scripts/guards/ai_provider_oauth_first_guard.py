#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
settings = (ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift").read_text()
ai_provider = (ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift").read_text()

print("AI_PROVIDER_OAUTH_FIRST_GUARD")
forbidden_ui = [
    "Paste API key",
    "Enter API key",
    "Provide API key",
    "Paste client secret",
    "Enter client secret",
    "Paste refresh token",
    "Enter refresh token",
    "Paste access token",
    "Enter access token",
    "Paste private key",
    "Enter private key",
]
lower_settings = settings.lower()
for text in forbidden_ui:
    if text.lower() in lower_settings:
        print(f"FAIL: user-facing provider UI contains forbidden onboarding text: {text}")
        sys.exit(1)
print("PASS: no API-key or secret-paste onboarding text in provider UI")

if 'case oauth = "OAUTH"' not in ai_provider:
    print("FAIL: OAUTH auth model missing")
    sys.exit(1)
print("PASS: OAUTH auth model present")

if "provider.provider_id == .gemini" not in settings:
    print("FAIL: non-Gemini provider actions are not gated")
    sys.exit(1)
print("PASS: unverified provider actions remain gated")
print("SUCCESS: OAuth-first guard passed.")
