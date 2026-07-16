#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
ai_view = (ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift").read_text()
ai_provider = (ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift").read_text()

print("AI_WORKSPACE_GEMINI_CHATGPT_PICKER_GUARD")
for marker in ["AIWorkspaceProviderPicker", "selectedProviderID", "ForEach(providers)", "runSafeProviderAction"]:
    if marker not in ai_view:
        print(f"FAIL: missing workspace marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")
for provider in ["case gemini", "case chatgpt"]:
    if provider not in ai_provider:
        print(f"FAIL: missing provider picker source {provider}")
        sys.exit(1)
print("PASS: Gemini and ChatGPT are picker-source providers")
print("SUCCESS: Gemini/ChatGPT picker guard passed.")
