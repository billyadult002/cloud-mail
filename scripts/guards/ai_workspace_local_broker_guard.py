#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
provider = (ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift").read_text()
settings = (ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift").read_text()
view = (ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift").read_text()

print("AI_WORKSPACE_LOCAL_BROKER_GUARD")
for marker in ["selectedProviderID", "runSafeProviderAction", "ChatGPT Local Broker", "Owner Mac Local Broker", "Requires paired Owner Mac"]:
    if marker not in provider + settings + view:
        print(f"FAIL: missing AI Workspace local broker marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")
if "Provider is not connected. Connect or reconnect this provider to use AI actions." not in view:
    print("FAIL: no visible provider-specific failure state")
    sys.exit(1)
print("PASS: visible provider-specific failure state")
print("SUCCESS: AI Workspace local broker guard passed.")
