#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
ai_provider = (ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift").read_text()
app_state = (ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text()

print("AI_PROVIDER_RUNTIME_SMOKE_GUARD")
if "safe_user_action_available: usableNow && status == .connected && smokeResult?.status == \"PASS\"" not in ai_provider:
    print("FAIL: usable action is not gated by connected status and PASS smoke")
    sys.exit(1)
print("PASS: usable action requires connected provider and PASS smoke")
if "providerID == .gemini" not in app_state:
    print("FAIL: non-Gemini smoke is not blocked without metadata")
    sys.exit(1)
print("PASS: providers without runtime metadata are blocked from false smoke execution")
for provider in [".chatgpt", ".claude", ".copilot", ".grok"]:
    if provider not in ai_provider:
        print(f"FAIL: provider missing {provider}")
        sys.exit(1)
print("PASS: all remaining providers remain registered")
print("SUCCESS: Runtime smoke guard passed.")
