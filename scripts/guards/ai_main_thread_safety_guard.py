#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
EMAIL_DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
APPLE_PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AppleFoundationProvider.swift"


def require(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    app = APP_STATE.read_text()
    email = EMAIL_DETAIL.read_text()
    provider = APPLE_PROVIDER.read_text()
    print("AI_MAIN_THREAD_SAFETY_GUARD")
    require("Task.detached" in provider, "Apple availability check is off the main actor")
    require("await MainActor.run" in email, "Email Detail writes async result state on MainActor")
    require("currentAIActionTask?.cancel()" in email, "Email Detail cancels previous AI tasks")
    require("guard !aiActionPhase.isRunning else { return }" in email, "Email Detail debounces duplicate AI tasks")
    require("withThrowingTaskGroup" in app, "AppState timeout helper races model work against timeout")
    print("SUCCESS: AI main-thread safety guard passed.")


if __name__ == "__main__":
    main()
