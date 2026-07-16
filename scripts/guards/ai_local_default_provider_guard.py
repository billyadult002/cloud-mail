#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
EMAIL_DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"


def require(ok: bool, message: str) -> None:
    if not ok:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    app_state = APP_STATE.read_text()
    email_detail = EMAIL_DETAIL.read_text()
    ai_view = AI_VIEW.read_text()
    print("AI_LOCAL_DEFAULT_PROVIDER_GUARD")
    require('AIProviderKind.apple.rawValue' in app_state, "persisted preferred provider defaults to Apple Intelligence")
    require('localAIAllowed && localAIReady' in email_detail, "Email Detail availability is Apple-local only")
    require('Default provider", value: "Apple Intelligence"' in ai_view, "AI Center displays Apple Intelligence as default provider")
    require("Gemini and ChatGPT are optional provider routes in AI Center only" in ai_view, "AI Center marks Gemini/ChatGPT optional")
    print("SUCCESS: AI local default provider guard passed.")


if __name__ == "__main__":
    main()
