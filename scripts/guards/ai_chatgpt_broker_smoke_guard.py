#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "AI_CHATGPT_CODEX_BROKER_SMOKE_REPORT.md"
FINAL = ROOT / "AI_CHATGPT_CODEX_BROKER_GEMINI_REQUIRED_FINAL_REPORT.md"
AI_PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"

print("AI_CHATGPT_BROKER_SMOKE_GUARD")
if not REPORT.exists() or not FINAL.exists():
    print("FAIL: required smoke/final reports missing")
    sys.exit(1)

report = REPORT.read_text(errors="ignore")
final = FINAL.read_text(errors="ignore")
provider = AI_PROVIDER.read_text(errors="ignore")

if "Official CLI synthetic smoke: PASS" not in report:
    print("FAIL: official CLI smoke evidence missing")
    sys.exit(1)
print("PASS: official CLI smoke evidence recorded")

if "CloudMail iPhone AI Workspace broker smoke: NOT EXECUTED" not in report:
    print("FAIL: app-level broker smoke truth missing")
    sys.exit(1)
print("PASS: app-level ChatGPT broker smoke is not falsely claimed")

if "safe_user_action_available: usableNow && status == .connected && smokeResult?.status == \"PASS\"" not in provider:
    print("FAIL: ChatGPT usability can be set without PASS smoke")
    sys.exit(1)
print("PASS: provider usability still requires PASS smoke")

if "BLOCKED_CHATGPT_CODEX_BROKER_NOT_FEASIBLE" not in final:
    print("FAIL: final report does not preserve broker blocker")
    sys.exit(1)
print("PASS: broker blocker preserved")
print("SUCCESS: ChatGPT broker smoke guard passed.")
