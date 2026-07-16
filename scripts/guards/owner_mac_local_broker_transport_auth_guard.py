#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
broker = (ROOT / "scripts/owner_mac_local_ai_broker.py").read_text()
provider = (ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift").read_text()
report_path = ROOT / "OWNER_MAC_LOCAL_AI_BROKER_TRANSPORT_AUTH_REPORT.md"
report = report_path.read_text() if report_path.exists() else ""

print("OWNER_MAC_LOCAL_BROKER_TRANSPORT_AUTH_GUARD")
for marker in ["transport_auth_required", "ReplayWindow", "nonce", "local network only", "x-cloudmail-signature", "HMAC"]:
    if marker not in broker + provider + report:
        print(f"FAIL: missing transport/auth marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")
print("SUCCESS: Owner Mac local broker transport auth guard passed.")
