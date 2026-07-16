#!/usr/bin/env python3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
AIVIEW = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Views" / "AIView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    ai = AIVIEW.read_text(encoding="utf-8")
    panel_start = ai.find("private var safeActionPanel")
    panel_end = ai.find("private var workspaceChat")
    panel = ai[panel_start:panel_end]

    print("SAFE_MAIL_ACTIONS_NO_STATUS_ONLY_EXECUTION_GUARD")
    require("Picker(\"Action\"" not in panel, "Safe Mail Actions does not use a passive provider/action picker")
    require("runSafeProviderAction" not in ai, "status-only Safe provider runner is removed")
    require("selectedSafeWorkflow" not in ai, "Safe Mail Actions no longer waits on hidden selected state")
    require("Gemini" not in panel and "ChatGPT" not in panel and "Local Broker" not in panel, "Safe Mail Actions does not expose disabled providers")
    require("providerId" not in panel and "methodId" not in panel, "Safe Mail Actions does not execute provider-status metadata")
    require("safeWorkflowResult" not in ai, "Safe result is owned by the live action page")
    print("SUCCESS: Safe Mail Actions no status-only execution guard passed.")


if __name__ == "__main__":
    main()
