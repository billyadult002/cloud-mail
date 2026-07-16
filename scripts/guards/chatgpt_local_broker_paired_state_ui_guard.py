#!/usr/bin/env python3
"""Guard the ChatGPT Local Broker paired-state UI transition."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
SETTINGS = ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift"
GEMINI_GUARD_FILE = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    sys.exit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)
    print(f"PASS: {message}")


def main() -> None:
    ai_view = AI_VIEW.read_text(encoding="utf-8")
    app_state = APP_STATE.read_text(encoding="utf-8")
    settings = SETTINGS.read_text(encoding="utf-8")
    provider = GEMINI_GUARD_FILE.read_text(encoding="utf-8")

    print("CHATGPT_LOCAL_BROKER_PAIRED_STATE_UI_GUARD")
    require("ChatGPTLocalBrokerCardState" in ai_view, "ChatGPT card uses an explicit local broker state model")
    require("case pairedSmokeRequired" in ai_view, "paired-but-not-smoked state exists")
    require('case .pairedSmokeRequired: return "Paired"' in ai_view, "PAIRED badge is preserved")
    require('return "Run Safe Test"' in ai_view, "paired/PASS primary action can become Run Safe Test")
    require("runChatGPTCardSafeTest()" in ai_view, "ChatGPT card can run the safe smoke test")
    require("app.runSafeProviderAction(providerID: .chatgpt, action: .summarize)" in ai_view, "card safe test uses shared ChatGPT safe action")
    require("chatGPTCardMessage" in ai_view, "pair/smoke guidance is inline inside the ChatGPT card")
    require("App-compatible signed broker smoke passed." in ai_view, "PASS helper text is present")
    require("Paired with Owner Mac. Run Safe Test to verify ChatGPT Local Broker." in ai_view, "paired helper text is present")
    require('localError = paired ? "Pair Owner Mac completed' not in ai_view, "pair success is not written to the global red error surface")
    require("Pair Owner Mac completed. Run Safe Test to verify ChatGPT Local Broker." not in settings, "Settings no longer uses the stale pair-completed copy")
    require('status: "RUNNING"' in app_state, "ChatGPT smoke writes RUNNING state")
    require('status: passed ? "PASS" : "FAIL"' in app_state, "ChatGPT smoke writes PASS/FAIL state")
    require("errorMessage = nil" in app_state, "successful pairing/smoke clears stale global app error")
    require('displayName: "Gemini"' in provider and "google_oauth_cloud_runtime" in provider, "Gemini registry remains preserved")
    print("SUCCESS: ChatGPT paired-state UI guard passed.")


if __name__ == "__main__":
    main()
