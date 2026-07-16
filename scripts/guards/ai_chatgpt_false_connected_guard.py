#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
ai_provider = (ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift").read_text()

print("AI_CHATGPT_FALSE_CONNECTED_GUARD")
if "case .chatgpt, .claude, .copilot, .grok:" not in ai_provider or "return .unavailable" not in ai_provider:
    print("FAIL: ChatGPT is not held unavailable by default")
    sys.exit(1)
print("PASS: ChatGPT remains unavailable without runtime smoke evidence")
if '"oauth_metadata": "missing"' not in ai_provider or '"runtime_metadata": "missing"' not in ai_provider:
    print("FAIL: ChatGPT missing metadata is not explicit")
    sys.exit(1)
print("PASS: ChatGPT metadata missing state explicit")
print("SUCCESS: ChatGPT false-connected guard passed.")
