#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
REPORT = ROOT / "AI_CHATGPT_CODEX_CLI_AUTH_BROKER_RESEARCH_REPORT.md"

print("AI_CHATGPT_CODEX_BROKER_RESEARCH_GUARD")
if not REPORT.exists():
    print("FAIL: research report missing")
    sys.exit(1)

text = REPORT.read_text(errors="ignore")
required = [
    "Codex CLI installed: YES",
    "Codex CLI authenticated: YES",
    "Official CLI synthetic smoke: PASS",
    "Browser ChatGPT login alone is insufficient",
    "Owner-device/local only",
    "No token values were printed",
]
for marker in required:
    if marker not in text:
        print(f"FAIL: missing research marker: {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")

print("SUCCESS: Codex broker research guard passed.")
