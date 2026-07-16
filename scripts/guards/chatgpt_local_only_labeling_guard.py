#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
provider = (ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift").read_text()
settings = (ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift").read_text()

print("CHATGPT_LOCAL_ONLY_LABELING_GUARD")
for marker in ["ChatGPT Local Broker", "Owner Mac Local Broker", "local_only", "Requires paired Owner Mac"]:
    if marker not in provider + settings:
        print(f"FAIL: missing local-only label {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")
if "ChatGPT Cloud OAuth" in provider + settings:
    print("FAIL: ChatGPT is mislabeled as Cloud OAuth")
    sys.exit(1)
print("PASS: no ChatGPT Cloud OAuth label")
print("SUCCESS: ChatGPT local-only labeling guard passed.")
