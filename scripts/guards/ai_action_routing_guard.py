#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
APP = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
AI = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
REPORT = ROOT / "AI_ACTION_ROUTING_FIX_REPORT.md"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("AI_ACTION_ROUTING_GUARD")
    detail = DETAIL.read_text()
    app = APP.read_text()
    ai = AI.read_text()
    require("canGenerateBriefing" in detail and "aiConsent.cloudAIEnabled" in detail, "Email Detail AI respects consent/cloud gating")
    require("providerCapabilityRequired: \"translation\"" in detail, "Translate declares translation capability")
    require("providerID == .chatgpt" in app and "chatGPTLocalBrokerSafeAction" in app, "ChatGPT remains local broker routed")
    require("providerID == .gemini" in app and "geminiOAuthStatus?.authorized" in app, "Gemini action route checks OAuth status")
    require("last_smoke_result == \"PASS\"" in ai, "Gemini usable UI remains smoke-pass aware")
    require("Cloud OAuth" not in ai or "ChatGPT Local Broker" in ai, "ChatGPT is not mislabeled as Cloud OAuth")
    require(REPORT.exists(), "AI action routing report exists")
    print("SUCCESS: AI action routing guard passed.")


if __name__ == "__main__":
    main()
