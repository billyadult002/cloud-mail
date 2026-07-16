#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
broker = (ROOT / "scripts/owner_mac_local_ai_broker.py").read_text()

print("OWNER_MAC_BROKER_CHATGPT_CODEX_ADAPTER_GUARD")
for marker in [
    '"login", "status"',
    "Logged in using ChatGPT",
    "codex",
    "exec",
    "--ephemeral",
    "--sandbox",
    "read-only",
]:
    if marker not in broker:
        print(f"FAIL: missing ChatGPT Codex adapter marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")
print("SUCCESS: ChatGPT Codex adapter guard passed.")
