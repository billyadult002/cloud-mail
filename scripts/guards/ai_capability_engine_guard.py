#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
ai_provider = (ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift").read_text()
app_state = (ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text()
ai_view = (ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift").read_text()
adapter = (ROOT / "platform/cloud-mail/mail-worker/src/service/provider-runtime-adapters.js").read_text()

print("AI_CAPABILITY_ENGINE_GUARD")
for cap in ["chat", "mail_summary", "draft_reply", "translation", "mail_search", "safe_test", "thread_summary", "tone_rewrite", "future"]:
    if cap not in ai_provider:
        print(f"FAIL: missing capability {cap}")
        sys.exit(1)
    print(f"PASS: capability {cap}")
for marker in ["runSafeProviderAction", "AIWorkspaceProviderPicker", "AIActionResultView"]:
    if marker not in app_state + ai_view:
        print(f"FAIL: missing capability engine marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")
if "Project Alpha meeting moved from 2 PM to 4 PM" not in adapter:
    print("FAIL: safe synthetic email prompt missing")
    sys.exit(1)
print("PASS: safe synthetic email prompt present")
print("SUCCESS: Capability engine guard passed.")
