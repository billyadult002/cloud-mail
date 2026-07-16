#!/usr/bin/env python3
import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

print("OWNER_MAC_BROKER_RUNTIME_PREP_GUARD")
result = subprocess.run(
    [sys.executable, str(ROOT / "scripts/owner_mac_local_ai_broker.py"), "status", "--provider", "chatgpt"],
    text=True,
    capture_output=True,
    cwd=ROOT,
    timeout=20,
)
if result.returncode != 0:
    print(result.stderr)
    print("FAIL: broker status command failed")
    sys.exit(1)
status = json.loads(result.stdout)
for key, expected in {
    "provider_id": "chatgpt",
    "adapter_id": "chatgpt_codex_cli",
    "installed": True,
    "codex_authenticated": True,
    "local_only": True,
}.items():
    if status.get(key) != expected:
        print(f"FAIL: {key} expected {expected!r}, got {status.get(key)!r}")
        sys.exit(1)
    print(f"PASS: {key}")
print("SUCCESS: broker runtime prep guard passed.")
