#!/usr/bin/env python3
"""Guard provider picker/card consistency for Safe Mail Actions."""

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
AI_PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)
    print(f"PASS: {message}")


def entry(provider: str, text: str) -> str:
    pattern = rf"AIProviderRegistryEntry\(\s*providerID: \.{provider},.*?\n\s*\)"
    match = re.search(pattern, text, flags=re.S)
    if not match:
        fail(f"provider entry not found: {provider}")
    return match.group(0)


def main() -> None:
    provider = AI_PROVIDER.read_text(encoding="utf-8")
    ai_view = AI_VIEW.read_text(encoding="utf-8")
    app_state = APP_STATE.read_text(encoding="utf-8")

    print("AI_PROVIDER_PICKER_CARD_CONSISTENCY_GUARD")
    require("providers.filter(\\.visible_in_action_picker)" in ai_view, "picker filters by registry visibility")
    require("action_picker_enabled" in ai_view, "run button respects action picker enabled flag")
    require("status only" in ai_view, "non-runnable visible provider is labeled status only")
    require("providerID == .chatgpt" in app_state, "ChatGPT Local Broker safe action is explicitly mapped")
    require("chatGPTLocalBrokerSafeAction" in app_state, "ChatGPT Local Broker safe action result path exists")
    require("safe_user_action_available: (usableNow && status == .connected && smokeResult?.status == \"PASS\")" in provider, "Gemini runnable state still requires smoke PASS")
    require('let hasBrokerSmokeEvidence = entry.providerID == .chatgpt && smokeResult?.status == "PASS"' in provider, "ChatGPT runnable state is backed by recorded broker smoke evidence")

    for provider_id in ["gemini", "chatgpt"]:
        require('"visible_in_action_picker": "true"' in entry(provider_id, provider), f"{provider_id} is intentionally visible in picker")

    for provider_id in ["claude", "copilot", "grok"]:
        require('"visible_in_action_picker": "false"' in entry(provider_id, provider), f"{provider_id} is hidden from executable picker")

    print("SUCCESS: AI provider picker/card consistency guard passed.")


if __name__ == "__main__":
    main()
