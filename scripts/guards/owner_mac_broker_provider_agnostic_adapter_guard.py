#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
broker = (ROOT / "scripts/owner_mac_local_ai_broker.py").read_text()
provider = (ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift").read_text()

print("OWNER_MAC_BROKER_PROVIDER_AGNOSTIC_ADAPTER_GUARD")
for marker in [
    "ADAPTERS =",
    "chatgpt_codex_cli",
    "claude_code_cli_if_available",
    "gemini_cli_or_oauth_runtime_if_available",
    "grok_official_runtime_if_available",
    "future_provider",
    "owner_mac_local_broker",
]:
    if marker not in broker + provider:
        print(f"FAIL: missing adapter marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")
print("SUCCESS: provider-agnostic adapter guard passed.")
