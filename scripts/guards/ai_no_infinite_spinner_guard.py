#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
EMAIL_DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"


def require(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    app = APP_STATE.read_text()
    email = EMAIL_DETAIL.read_text()
    print("AI_NO_INFINITE_SPINNER_GUARD")
    require("appleLocalActionTimeoutSeconds: UInt64 = 20" in app, "Apple local action timeout is 20 seconds")
    require("withLocalAITimeout" in app, "local AI calls are timeout wrapped")
    require("EmailAIActionPhase" in email, "Email Detail has explicit action phase")
    for state in ["case idle", "case running", "case success", "case failure", "case timeout", "case cancelled"]:
        require(state in email, f"Email Detail state exists: {state}")
    require("currentAIActionTask = nil" in email, "Email Detail clears task state")
    print("SUCCESS: AI no infinite spinner guard passed.")


if __name__ == "__main__":
    main()
