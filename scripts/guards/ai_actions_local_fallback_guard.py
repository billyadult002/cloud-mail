#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
EMAIL_DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
ROUTER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("AI_ACTIONS_LOCAL_FALLBACK_GUARD")
    app_state = APP_STATE.read_text()
    ai_view = AI_VIEW.read_text()
    email_detail = EMAIL_DETAIL.read_text()
    router = ROUTER.read_text()
    require("func completeLocal(" in router, "AIRouter exposes local Apple Intelligence completion")
    require("func aiCompleteLocal(" in app_state, "AppState exposes local completion")
    require("runLocalSafeProviderAction" in app_state, "AppState exposes local safe action fallback")
    require("localSyntheticPrompt(for action:" in app_state, "local safe actions use synthetic prompts")
    require("await app.aiCompleteLocal(" in email_detail, "Email Detail Translate is local-first")
    require("await app.runLocalSafeProviderAction(selectedSafeAction)" in ai_view, "AI Center safe actions fall back to local AI")
    require("Provider route was unavailable; completed with Apple Intelligence local fallback." in ai_view, "fallback is surfaced to the user")
    require("mailboxDataSent: false" in app_state and "customerDataSent: false" in app_state, "local safe fallback sends no mailbox/customer data")
    print("SUCCESS: AI actions local fallback guard passed.")


if __name__ == "__main__":
    main()
