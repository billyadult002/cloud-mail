#!/usr/bin/env python3
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
paths = [
    ROOT / "scripts/owner_mac_local_ai_broker.py",
    ROOT / "CHATGPT_OWNER_MAC_LOCAL_BROKER_DISCOVERY_REPORT.md",
    ROOT / "CHATGPT_OWNER_MAC_LOCAL_BROKER_ARCHITECTURE_REPORT.md",
    ROOT / "CHATGPT_OWNER_MAC_LOCAL_BROKER_SMOKE_REPORT.md",
]

forbidden = [
    ".codex/auth.json",
    "access_token",
    "refresh_token",
    "id_token",
    "Chrome/Cookies",
    "Cookies",
]
secret_shapes = [
    re.compile(r"sk-[A-Za-z0-9_-]{12,}"),
    re.compile(r"Bearer\s+[A-Za-z0-9._-]{16,}", re.I),
    re.compile(r"eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}"),
]

print("OWNER_MAC_LOCAL_BROKER_NO_TOKEN_FILE_ACCESS_GUARD")
for path in paths:
    if not path.exists():
        continue
    text = path.read_text(errors="ignore")
    if path.name == "owner_mac_local_ai_broker.py":
        for marker in forbidden:
            if marker in text:
                print(f"FAIL: broker code references forbidden token/session marker {marker}")
                sys.exit(1)
    for pattern in secret_shapes:
        if pattern.search(text):
            print(f"FAIL: possible secret value in {path.relative_to(ROOT)}")
            sys.exit(1)
print("PASS: broker code does not read token files and reports contain no token-shaped values")
print("SUCCESS: Owner Mac local broker no-token-file-access guard passed.")
