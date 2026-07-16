#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMAIL_DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"


def require(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    email = EMAIL_DETAIL.read_text()
    app = APP_STATE.read_text()
    print("APPLE_LOCAL_SUMMARIZE_RESULT_GUARD")
    require("triageLocalStrict" in app, "strict Apple local summary runner exists")
    require("await app.triageLocalStrict" in email, "Email Detail summary uses strict Apple local runner")
    require("AI summary ready." in email, "summary success surface exists")
    require("Retry" in email or "retryAIAction" in email, "summary failure can be retried")
    print("SUCCESS: Apple local summarize result guard passed.")


if __name__ == "__main__":
    main()
