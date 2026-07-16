#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
ai_provider = (ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift").read_text()
app_state = (ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text()

print("AI_GEMINI_CHATGPT_REQUIRED_GUARD")
for provider in ["gemini", "chatgpt"]:
    if f"case {provider}" not in ai_provider or f"providerID: .{provider}" not in ai_provider:
        print(f"FAIL: required provider missing: {provider}")
        sys.exit(1)
    print(f"PASS: required provider registered: {provider}")

if "providerID == .gemini" not in app_state:
    print("FAIL: safe provider action no longer gates unsupported providers")
    sys.exit(1)
print("PASS: non-Gemini runtime actions remain blocked without metadata")

if '"oauth_metadata": "missing"' not in ai_provider or '"runtime_metadata": "missing"' not in ai_provider:
    print("FAIL: missing ChatGPT metadata state is not represented")
    sys.exit(1)
print("PASS: ChatGPT metadata blocker is represented")

print("BLOCKED: Gemini and ChatGPT mandatory usable PASS requires authenticated smoke evidence not present in source.")
print("SUCCESS: Required provider truth guard passed.")
