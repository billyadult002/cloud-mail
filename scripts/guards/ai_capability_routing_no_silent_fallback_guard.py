#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
app_state = (ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text()
ai_view = (ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift").read_text()

print("AI_CAPABILITY_ROUTING_NO_SILENT_FALLBACK_GUARD")
if "guard providerID == .gemini else" not in app_state:
    print("FAIL: unsupported providers are not explicitly blocked")
    sys.exit(1)
print("PASS: unsupported providers are explicitly blocked")
if "Provider is not connected. Connect or reconnect this provider to use AI actions." not in ai_view:
    print("FAIL: selected-provider failure does not surface a provider-specific error")
    sys.exit(1)
print("PASS: selected-provider failure is visible to the user")
if "selectedProviderID" not in ai_view:
    print("FAIL: provider routing is not explicitly selected")
    sys.exit(1)
print("PASS: provider routing is explicitly selected")
print("SUCCESS: No silent fallback guard passed.")
