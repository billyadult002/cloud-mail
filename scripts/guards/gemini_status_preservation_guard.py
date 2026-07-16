#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
provider = (ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift").read_text()
ai_view = (ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift").read_text()
gemini_provider = (ROOT / "files/GlassMail-project/GlassMail/AI/GeminiProvider.swift").read_text()

print("GEMINI_STATUS_PRESERVATION_GUARD")
if (
    'safe_user_action_available:' not in provider
    or 'usableNow && status == .connected && smokeResult?.status == "PASS"' not in provider
):
    print("FAIL: Gemini usable status is not smoke-gated")
    sys.exit(1)
print("PASS: Gemini usability remains smoke-gated")
if "Gemini" in ai_view:
    print("FAIL: Gemini user path reappeared in Apple Intelligence-only AI Center")
    sys.exit(1)
print("PASS: Gemini user path remains removed from AI Center")
if "Gemini account authorization is not available in this build." not in gemini_provider:
    print("FAIL: Gemini disabled-by-product guidance missing")
    sys.exit(1)
print("PASS: Gemini disabled-by-product guidance preserved")
print("SUCCESS: Gemini status preservation guard passed.")
