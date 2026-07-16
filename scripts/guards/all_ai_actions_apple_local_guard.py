#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VIEWS = ROOT / "files/GlassMail-project/GlassMail/Views"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
ROUTER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("ALL_AI_ACTIONS_APPLE_LOCAL_GUARD")
    router = ROUTER.read_text()
    app_state = APP_STATE.read_text()
    view_text = "\n".join(path.read_text() for path in VIEWS.glob("*.swift"))

    require("func triageLocal(" in router, "AIRouter has local triage")
    require("func draftReplyLocal(" in router, "AIRouter has local draft reply")
    require("func completeLocal(" in router, "AIRouter has local completion")
    require("func triageLocal(_ email:" in app_state, "AppState exposes local triage")
    require("func draftReplyLocal(for email:" in app_state, "AppState exposes local draft reply")
    require("func aiCompleteLocal(" in app_state, "AppState exposes local completion")
    require("await app.aiComplete(" not in view_text, "Views do not call generic provider completion directly")
    require("await app.draftReply(" not in view_text, "Views do not call generic provider draft directly")
    require("await app.triage(" not in view_text, "Views do not call generic provider triage directly")
    require("runBriefingIfAvailable(force: true)" in view_text, "Email Detail AI Summary routes through briefing action")
    require("isBriefingExpanded = true" in (VIEWS / "EmailDetailView.swift").read_text(), "Email Detail briefing auto-expands")
    print("SUCCESS: all AI actions Apple local guard passed.")


if __name__ == "__main__":
    main()
