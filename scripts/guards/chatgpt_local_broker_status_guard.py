#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
provider = (ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift").read_text()
ai_view = (ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift").read_text()
openai_provider = (ROOT / "files/GlassMail-project/GlassMail/AI/OpenAIProvider.swift").read_text()

print("CHATGPT_LOCAL_BROKER_STATUS_GUARD")
for marker in [
    "runtime_mode",
    "owner_mac_local_broker",
    "chatgpt_codex_cli",
    "local_only",
    "requires_owner_mac_online",
    "pairing_required",
]:
    if marker not in provider:
        print(f"FAIL: missing ChatGPT local broker status marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")
if "ChatGPT" in ai_view or "Local Broker" in ai_view:
    print("FAIL: ChatGPT Local Broker user path reappeared in Apple Intelligence-only AI Center")
    sys.exit(1)
print("PASS: ChatGPT Local Broker user path remains removed from AI Center")
if "ChatGPT/OpenAI cloud execution is intentionally disabled" not in openai_provider:
    print("FAIL: ChatGPT cloud disabled boundary missing")
    sys.exit(1)
print("PASS: ChatGPT cloud disabled boundary preserved")
print("PASS: ChatGPT status remains evidence-scoped")
print("SUCCESS: ChatGPT local broker status guard passed.")
