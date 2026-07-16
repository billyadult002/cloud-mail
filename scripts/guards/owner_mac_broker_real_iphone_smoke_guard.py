#!/usr/bin/env python3
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
smoke_path = ROOT / "artifacts/owner-mac-local-ai-broker-real-iphone-ui/app-compatible-smoke.json"
report = (ROOT / "OWNER_MAC_LOCAL_AI_BROKER_REAL_IPHONE_SMOKE_REPORT.md").read_text() if (ROOT / "OWNER_MAC_LOCAL_AI_BROKER_REAL_IPHONE_SMOKE_REPORT.md").exists() else ""

print("OWNER_MAC_BROKER_REAL_IPHONE_SMOKE_GUARD")
if not smoke_path.exists():
    print("FAIL: smoke artifact missing")
    sys.exit(1)
data = json.loads(smoke_path.read_text())
checks = {
    "ok": True,
    "provider_id": "chatgpt",
    "adapter_id": "chatgpt_codex_cli",
    "runtime_mode": "owner_mac_local_broker",
    "transport": "http_local_signed_hmac",
    "secret_exposure": False,
}
for key, expected in checks.items():
    if data.get(key) != expected:
        print(f"FAIL: {key} expected {expected!r}, got {data.get(key)!r}")
        sys.exit(1)
    print(f"PASS: {key}")
if not data.get("redacted_result"):
    print("FAIL: redacted result missing")
    sys.exit(1)
print("PASS: redacted result returned")
if "Direct manual real iPhone UI smoke: NOT CLAIMED" not in report:
    print("FAIL: direct UI boundary missing")
    sys.exit(1)
print("PASS: direct UI boundary recorded")
print("SUCCESS: real iPhone broker smoke guard passed.")
