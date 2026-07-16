#!/usr/bin/env python3
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
report = (ROOT / "OWNER_MAC_LOCAL_AI_BROKER_REAL_IPHONE_PAIRING_REPORT.md").read_text() if (ROOT / "OWNER_MAC_LOCAL_AI_BROKER_REAL_IPHONE_PAIRING_REPORT.md").exists() else ""
smoke_path = ROOT / "artifacts/owner-mac-local-ai-broker-real-iphone-ui/app-compatible-smoke.json"

print("OWNER_MAC_BROKER_REAL_IPHONE_PAIRING_GUARD")
if not smoke_path.exists():
    print("FAIL: app-compatible smoke artifact missing")
    sys.exit(1)
data = json.loads(smoke_path.read_text())
if data.get("pairing_state") != "paired":
    print("FAIL: app-compatible pairing did not reach paired state")
    sys.exit(1)
print("PASS: app-compatible pairing reached paired state")
if "Direct manual real iPhone UI pairing: NOT CLAIMED" not in report:
    print("FAIL: manual UI pairing boundary missing")
    sys.exit(1)
print("PASS: manual UI pairing boundary recorded")
print("SUCCESS: real iPhone pairing path guard passed.")
