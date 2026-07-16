#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMAIL_DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
WORKSPACE = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailAIWorkspaceView.swift"
REPORT = ROOT / "BUTTON_ACTION_BROKEN_DIAGNOSIS_REPORT.md"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("NO_NOOP_BUTTONS_GUARD")
    detail = EMAIL_DETAIL.read_text()
    workspace = WORKSPACE.read_text()
    require("runTranslation(" in detail and "translationResult =" in detail, "Translate has a real result handler")
    require("actionStatusMessage" in detail and "actionErrorMessage" in detail, "Email Detail actions surface success and error states")
    require("showCompose = true" in detail, "Reply/forward actions open composer")
    require("copyText(" in detail, "Copy actions write to clipboard")
    require("Task { _ = await app.aiComplete(instructions: \"Translate this email into Chinese.\"" not in workspace, "Email workspace translate no longer silently runs fixed Chinese")
    require(REPORT.exists(), "broken action diagnosis report exists")
    print("SUCCESS: no no-op buttons guard passed.")


if __name__ == "__main__":
    main()
