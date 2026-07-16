#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"
REPORT = ROOT / "AI_WORKSPACE_GEMINI_CHATGPT_REQUIRED_REPORT.md"

print("AI_WORKSPACE_GEMINI_CHATGPT_REQUIRED_GUARD")
view = VIEW.read_text(errors="ignore")
provider = PROVIDER.read_text(errors="ignore")
report = REPORT.read_text(errors="ignore") if REPORT.exists() else ""

for marker in ["AIWorkspaceProviderPicker", "selectedProviderID", "ForEach(providers)", "runSafeProviderAction", "AIActionResultView"]:
    if marker not in view:
        print(f"FAIL: missing AI Workspace marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")

for marker in ["case gemini", "case chatgpt", "providerID: .gemini", "providerID: .chatgpt"]:
    if marker not in provider:
        print(f"FAIL: missing provider marker {marker}")
        sys.exit(1)
print("PASS: Gemini and ChatGPT remain provider-picker sources")

if "No silent fallback: PASS" not in report:
    print("FAIL: workspace no-silent-fallback result missing")
    sys.exit(1)
print("PASS: workspace no-silent-fallback result recorded")
print("SUCCESS: AI Workspace Gemini/ChatGPT required guard passed.")
