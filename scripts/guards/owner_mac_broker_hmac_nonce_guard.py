#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
broker = (ROOT / "scripts/owner_mac_local_ai_broker.py").read_text()

print("OWNER_MAC_BROKER_HMAC_NONCE_GUARD")
for marker in [
    "hmac.new",
    "x-cloudmail-signature",
    "x-cloudmail-timestamp",
    "x-cloudmail-nonce",
    "REQUEST_TTL_SECONDS",
    "ReplayWindow",
    "replay_rejected",
    "timestamp_expired",
    "signature_invalid",
]:
    if marker not in broker:
        print(f"FAIL: missing HMAC/nonce marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")
print("SUCCESS: HMAC nonce guard passed.")
