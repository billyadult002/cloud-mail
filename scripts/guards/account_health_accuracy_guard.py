#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
app = (ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text()
settings = (ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift").read_text()
models = (ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift").read_text()

print("ACCOUNT_HEALTH_ACCURACY_GUARD")
for marker in ["sendCapabilityReason(for account:", "Reconnect required for send", "Delegated receive-only", "Send capability"]:
    if marker not in app + settings + models:
        print(f"FAIL: missing account health marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")
print("SUCCESS: Account health accuracy guard passed.")
