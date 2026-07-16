#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
report = (ROOT / "CHATGPT_OWNER_MAC_LOCAL_BROKER_SMOKE_REPORT.md").read_text() if (ROOT / "CHATGPT_OWNER_MAC_LOCAL_BROKER_SMOKE_REPORT.md").exists() else ""
provider = (ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift").read_text()

print("OWNER_MAC_LOCAL_BROKER_SMOKE_GUARD")
if "ChatGPT app-compatible paired broker smoke: PASS" not in report:
    print("FAIL: ChatGPT owner-Mac broker smoke PASS not recorded")
    sys.exit(1)
print("PASS: ChatGPT owner-Mac broker harness smoke recorded")
if "Direct real iPhone UI broker smoke: NOT MANUALLY VERIFIED" not in report:
    print("FAIL: iPhone broker smoke is not honestly marked incomplete")
    sys.exit(1)
print("PASS: real iPhone broker smoke not falsely claimed")
if (
    'safe_user_action_available:' not in provider
    or 'smokeResult?.status == "PASS"' not in provider
    or "hasBrokerSmokeEvidence" not in provider
):
    print("FAIL: provider usability does not require PASS smoke")
    sys.exit(1)
print("PASS: provider usability still requires PASS smoke")
print("SUCCESS: Owner Mac local broker smoke guard passed.")
