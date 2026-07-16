#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
WORKSPACE_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/MobileWorkspaceView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    ai_source = AI_VIEW.read_text()
    workspace_source = WORKSPACE_VIEW.read_text()
    print("AI_BRIEFING_HEALTH_CENTER_GUARD")
    require("briefingHealthCard" not in ai_source, "AI Briefing / Health is not duplicated outside AI Workspace")
    require("briefingHealthConsole" in workspace_source, "AI Workspace includes a compact briefing/health console")
    require("app.mailOSBriefingSnapshot" in workspace_source, "AI Workspace reads the shared Mail OS briefing snapshot")
    require("app.mailboxHealthSnapshots" in workspace_source, "AI Workspace reads the shared mailbox health snapshots")
    require("app.aiRuntimeStatusSnapshot" in workspace_source, "AI Workspace reads the shared AI runtime status")
    require("AI Briefing / Health" in workspace_source, "AI Workspace exposes user-visible AI Briefing / Health label")
    require("Mailbox Health" in workspace_source, "AI Workspace exposes mailbox health rows")
    require("Task { await app.refresh() }" in workspace_source, "AI Workspace briefing/health console supports refresh")
    print("SUCCESS: AI briefing/health center guard passed.")


if __name__ == "__main__":
    main()
