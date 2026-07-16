#!/usr/bin/env python3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
AIVIEW = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Views" / "AIView.swift"
MODELS = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Models" / "Models.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    ai = AIVIEW.read_text(encoding="utf-8")
    models = MODELS.read_text(encoding="utf-8")
    panel_start = ai.find("private var safeActionPanel")
    panel_end = ai.find("private var workspaceChat")
    panel = ai[panel_start:panel_end]
    live_start = ai.find("private struct SafeMailActionLiveView")
    live = ai[live_start:]

    print("SAFE_MAIL_ACTIONS_ACTION_FIRST_REAL_USE_GUARD")
    require("AIWorkspaceRealWorkflow.allCases" in panel, "Safe Mail Actions renders real mail workflows")
    require("NavigationLink" in panel and "SafeMailActionLiveView(workflow: workflow)" in panel, "each Safe Mail Action opens a live result page")
    for title in ["Inbox Summary", "Suggested Reply", "Thread Digest", "Draft Generation", "Multi-email Analysis"]:
        require(title in models, f"workflow exists: {title}")
    require("app.aiWorkspaceWorkflow(workflow)" in live, "Safe Mail Action live page executes selected workflow")
    require("Running locally with Apple Intelligence..." in live, "Safe Mail Action live page shows running state")
    require('LabeledContent("AI route", value: "Apple Intelligence")' in live, "Safe Mail Action shows Apple Intelligence route")
    require("AIActionResultView(result: nil, workflowResult: result, error: nil)" in live, "Safe Mail Action surfaces workflow result")
    print("SUCCESS: Safe Mail Actions action-first real-use guard passed.")


if __name__ == "__main__":
    main()
