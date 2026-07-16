#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"

print("AI_NO_SILENT_FALLBACK_GUARD")
app_state = APP_STATE.read_text(errors="ignore")
ai_view = AI_VIEW.read_text(errors="ignore")

if "guard providerID == .gemini else" not in app_state:
    print("FAIL: unsupported providers are not explicitly blocked")
    sys.exit(1)
print("PASS: unsupported providers explicitly blocked")

if "Provider is not connected. Connect or reconnect this provider to use AI actions." not in ai_view:
    print("FAIL: visible selected-provider failure text missing")
    sys.exit(1)
print("PASS: provider-specific failure remains visible")

if "selectedProviderID" not in ai_view:
    print("FAIL: selected provider routing missing")
    sys.exit(1)
print("PASS: selected provider routing present")
print("SUCCESS: No silent fallback guard passed.")
