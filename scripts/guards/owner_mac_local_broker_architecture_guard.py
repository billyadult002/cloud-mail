#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
BROKER = ROOT / "scripts/owner_mac_local_ai_broker.py"
PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"
PLIST = ROOT / "files/GlassMail-project/Info.plist"

print("OWNER_MAC_LOCAL_BROKER_ARCHITECTURE_GUARD")
broker = BROKER.read_text()
provider = PROVIDER.read_text()
plist = PLIST.read_text()

markers = [
    "chatgpt_codex_cli",
    "claude_code_cli_if_available",
    "gemini_cli_or_oauth_runtime_if_available",
    "grok_official_runtime_if_available",
    "future_provider",
    "SAFE_SYNTHETIC_PROMPT",
    "ReplayWindow",
    "owner_mac_local_broker",
]
for marker in markers:
    if marker not in broker + provider:
        print(f"FAIL: missing broker marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")

for marker in ["NSLocalNetworkUsageDescription", "_cloudmail-ai-broker._tcp"]:
    if marker not in plist:
        print(f"FAIL: missing Info.plist marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")

print("SUCCESS: Owner Mac local broker architecture guard passed.")
