#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
broker = (ROOT / "scripts/owner_mac_local_ai_broker.py").read_text()
forbidden = ["Chrome/Cookies", "cookies.sqlite", "session_token", "browser_session_value", "ChatGPT web payload"]

print("OWNER_MAC_BROKER_NO_COOKIE_SESSION_ACCESS_GUARD")
for marker in forbidden:
    if marker in broker:
        print(f"FAIL: broker references forbidden browser/session marker {marker}")
        sys.exit(1)
print("PASS: broker has no cookie/session access path")
print("SUCCESS: no cookie/session access guard passed.")
