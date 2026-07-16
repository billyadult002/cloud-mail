#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
settings = (ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift").read_text()
ai_view = (ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift").read_text()
accounts = (ROOT / "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift").read_text()

print("AI_PROVIDER_UI_GUARD")
required = [
    "AIProviderManagementView",
    "AIProviderRow",
    "AIProviderStatusBadge",
    "AIProviderDetailView",
    "AIProviderCapabilityList",
    "AIProviderConnectionButton",
    "AIWorkspaceProviderPicker",
    "AIActionResultView",
]
combined = settings + ai_view + accounts
for item in required:
    if item not in combined:
        print(f"FAIL: missing UI component {item}")
        sys.exit(1)
    print(f"PASS: {item}")
if "CompactAccountPillView()" not in settings or "CompactAccountPillView()" not in ai_view:
    print("FAIL: secondary compact account pill not preserved")
    sys.exit(1)
print("PASS: CompactAccountPillView preserved on secondary AI surfaces")
print("SUCCESS: Provider UI guard passed.")
