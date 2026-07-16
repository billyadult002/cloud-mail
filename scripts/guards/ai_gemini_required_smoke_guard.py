#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "AI_GEMINI_REQUIRED_AUTHENTICATED_SMOKE_REPORT.md"
AI_PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"

print("AI_GEMINI_REQUIRED_SMOKE_GUARD")
if not REPORT.exists():
    print("FAIL: Gemini smoke report missing")
    sys.exit(1)

report = REPORT.read_text(errors="ignore")
provider = AI_PROVIDER.read_text(errors="ignore")
if "Gemini authenticated synthetic smoke: NOT OBSERVED" not in report:
    print("FAIL: Gemini smoke result truth missing")
    sys.exit(1)
print("PASS: Gemini smoke result truth recorded")

if "safe_user_action_available: usableNow && status == .connected && smokeResult?.status == \"PASS\"" not in provider:
    print("FAIL: Gemini usability can be set without PASS smoke")
    sys.exit(1)
print("PASS: Gemini usability still requires PASS smoke")
print("SUCCESS: Gemini required smoke guard passed.")
