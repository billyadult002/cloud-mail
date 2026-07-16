#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
provider = (ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift").read_text()
settings = (ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift").read_text()
ai_view = (ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift").read_text()
report = (ROOT / "AI_WORKSPACE_CHATGPT_LOCAL_BROKER_REAL_IPHONE_UI_REPORT.md").read_text() if (ROOT / "AI_WORKSPACE_CHATGPT_LOCAL_BROKER_REAL_IPHONE_UI_REPORT.md").exists() else ""

print("AI_WORKSPACE_CHATGPT_LOCAL_BROKER_UI_GUARD")
for marker in [
    "ChatGPT Local Broker",
    "Owner Mac Local Broker",
    "Requires paired Owner Mac",
    "selectedProviderID",
    "runSafeProviderAction",
    "Provider is not connected. Connect or reconnect this provider to use AI actions.",
]:
    if marker not in provider + settings + ai_view:
        print(f"FAIL: missing UI marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")
if "App-compatible broker smoke: PASS" not in report:
    print("FAIL: app-compatible broker smoke result missing from UI report")
    sys.exit(1)
print("PASS: UI report records app-compatible broker smoke")
print("SUCCESS: AI Workspace ChatGPT local broker UI guard passed.")
