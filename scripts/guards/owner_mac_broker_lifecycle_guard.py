#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
broker = (ROOT / "scripts/owner_mac_local_ai_broker.py").read_text()
report = (ROOT / "OWNER_MAC_LOCAL_AI_BROKER_LIFECYCLE_REPORT.md").read_text() if (ROOT / "OWNER_MAC_LOCAL_AI_BROKER_LIFECYCLE_REPORT.md").exists() else ""

print("OWNER_MAC_BROKER_LIFECYCLE_GUARD")
for marker in ["serve", "lifecycle", "GET /health", "POST /pair/revoke", "fail_closed"]:
    if marker not in broker + report:
        print(f"FAIL: missing lifecycle marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")
print("SUCCESS: lifecycle guard passed.")
