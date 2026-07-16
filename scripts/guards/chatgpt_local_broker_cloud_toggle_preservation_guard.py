#!/usr/bin/env python3
"""Guard ChatGPT Local Broker is not misclassified as generic Cloud AI."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[2]
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        print(f"FAIL: {message}")
        sys.exit(1)
    print(f"PASS: {message}")


def main() -> None:
    ai_view = AI_VIEW.read_text(encoding="utf-8")
    app_state = APP_STATE.read_text(encoding="utf-8")
    provider = PROVIDER.read_text(encoding="utf-8")

    print("CHATGPT_LOCAL_BROKER_CLOUD_TOGGLE_PRESERVATION_GUARD")
    require("ChatGPT Local Broker" in ai_view, "ChatGPT Local Broker card remains present")
    require("Owner Mac + Codex CLI" in ai_view, "Owner Mac + Codex CLI labeling remains present")
    require("Direct cloud account execution is not enabled" in ai_view, "ChatGPT cloud OAuth/API claim remains absent")
    require("CloudMail never reads token files" in ai_view, "token-file safety text remains present")
    require("if providerID == .chatgpt" in app_state, "ChatGPT has explicit local broker branch")
    chatgpt_branch_before_cloud_guard = app_state.find("if providerID == .chatgpt") < app_state.find("guard aiConsent.aiEnabled, aiConsent.cloudAIEnabled")
    require(chatgpt_branch_before_cloud_guard, "ChatGPT safe action is not blocked by Cloud AI processing toggle")
    require('"runtime_mode": "owner_mac_local_broker"' in provider, "registry keeps owner_mac_local_broker mode")
    require('"local_only": "true"' in provider, "registry keeps ChatGPT local-only")
    print("SUCCESS: ChatGPT local broker cloud-toggle preservation guard passed.")


if __name__ == "__main__":
    main()
