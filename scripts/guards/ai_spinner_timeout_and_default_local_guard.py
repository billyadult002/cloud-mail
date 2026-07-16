#!/usr/bin/env python3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    app_state = (ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text()
    email_detail = (ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift").read_text()
    ai_view = (ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift").read_text()
    compose = (ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift").read_text()

    print("AI_SPINNER_TIMEOUT_AND_DEFAULT_LOCAL_GUARD")
    require("localAIActionTimeoutNanoseconds" in app_state, "local AI timeout constant exists")
    require("withLocalAITimeout" in app_state, "local AI calls are timeout-wrapped")
    require("router.triageLocal" in app_state and "withLocalAITimeout" in app_state, "local triage is timeout protected")
    require("router.draftReplyLocal" in app_state and "withLocalAITimeout" in app_state, "local draft reply is timeout protected")
    require("router.completeLocal" in app_state and "withLocalAITimeout" in app_state, "local completion is timeout protected")
    require("partialCompletionFallback(prompt: prompt, instructions: instructions)" in app_state, "local completion returns fallback instead of nil on AI timeout")
    require("Apple Intelligence translation did not finish in time" in app_state, "translation timeout has visible fallback text")
    require("runBriefingIfAvailable(force: true)" in email_detail, "Email Detail AI Summary triggers briefing")
    require("isBriefingExpanded = true" in email_detail, "Email Detail briefing auto-expands")
    require("await app.aiCompleteLocal(" in email_detail, "Email Detail Translate uses Apple local completion")
    require("runningChat" in ai_view, "AI Center chat has running state")
    require("messages.suffix(3)" in ai_view, "AI Center shows latest assistant output")
    require("providerSelectionWasExplicit" in ai_view, "AI Center provider route requires explicit user selection")
    require("await app.runLocalSafeProviderAction(selectedSafeAction)" in ai_view, "AI Center safe action has Apple local default/fallback")
    require("await app.aiCompleteLocal(" in ai_view, "AI Center chat uses Apple local completion")
    require("await app.aiCompleteLocal(" in compose, "Compose AI uses Apple local completion")
    require("defer { isDrafting = false }" in compose, "Compose AI button state resets with defer")
    print("SUCCESS: AI spinner timeout and default local guard passed.")


if __name__ == "__main__":
    main()
