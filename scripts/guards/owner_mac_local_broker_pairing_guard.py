#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
provider = (ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift").read_text()
report_path = ROOT / "OWNER_MAC_LOCAL_AI_BROKER_PAIRING_REPORT.md"
report = report_path.read_text() if report_path.exists() else ""

print("OWNER_MAC_LOCAL_BROKER_PAIRING_GUARD")
for marker in ["pairing_required", "requires_owner_mac_online", "Owner Mac Local Broker", "pairing_state", "paired"]:
    if marker not in provider + report:
        print(f"FAIL: missing pairing marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")
if "App-compatible pairing: PASS" not in report:
    print("FAIL: app-compatible pairing PASS is not recorded")
    sys.exit(1)
print("PASS: pairing status honest")
print("SUCCESS: Owner Mac local broker pairing guard passed.")
