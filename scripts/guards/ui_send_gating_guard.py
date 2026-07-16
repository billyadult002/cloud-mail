#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
compose = (ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift").read_text()
app = (ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text()

print("UI_SEND_GATING_GUARD")
for marker in ["private var canSend", "fromAddress != nil", "app.canSend(from: address)", "sendCapabilityReason(for:"]:
    if marker not in compose + app:
        print(f"FAIL: missing UI send gating marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")
print("SUCCESS: UI send gating guard passed.")
