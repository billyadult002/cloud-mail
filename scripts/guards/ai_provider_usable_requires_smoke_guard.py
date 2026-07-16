#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
ai_provider = (ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift").read_text()
app_state = (ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text()

print("AI_PROVIDER_USABLE_REQUIRES_SMOKE_GUARD")
required = 'safe_user_action_available: (usableNow && status == .connected && smokeResult?.status == "PASS")'
if required not in ai_provider:
    print("FAIL: Gemini provider safe action availability is not gated by PASS smoke")
    sys.exit(1)
print("PASS: Gemini provider safe action availability requires connected status and PASS smoke")

if 'let hasBrokerSmokeEvidence = entry.providerID == .chatgpt && smokeResult?.status == "PASS"' not in ai_provider:
    print("FAIL: ChatGPT Local Broker usable state is not backed by app-compatible broker smoke evidence")
    sys.exit(1)
print("PASS: ChatGPT Local Broker usable state is backed by app-compatible broker smoke evidence")

if 'status: passed ? "PASS" : "FAIL"' not in app_state:
    print("FAIL: smoke result PASS/FAIL state is not recorded")
    sys.exit(1)
print("PASS: smoke result PASS/FAIL state recorded")
print("SUCCESS: Usable requires smoke guard passed.")
