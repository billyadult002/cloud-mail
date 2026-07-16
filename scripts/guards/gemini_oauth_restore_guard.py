#!/usr/bin/env python3
"""Guard Gemini OAuth restore metadata without exposing secrets."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/gemini-oauth-service.js"
BACKEND = ROOT / "files/GlassMail-project/GlassMail/Services/Backend.swift"
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)
    print(f"PASS: {message}")


def main() -> None:
    service = SERVICE.read_text(encoding="utf-8")
    backend = BACKEND.read_text(encoding="utf-8")
    ai_view = AI_VIEW.read_text(encoding="utf-8")

    print("GEMINI_OAUTH_RESTORE_GUARD")
    for marker in [
        "GOOGLE_OAUTH_CLIENT_ID",
        "GOOGLE_OAUTH_CLIENT_SECRET",
        "GOOGLE_OAUTH_REDIRECT_URI",
        "/api/ai/oauth/gemini/callback",
        "https://accounts.google.com/o/oauth2/v2/auth",
        "code_challenge_method",
        "S256",
    ]:
        require(marker in service, f"Gemini OAuth metadata path present: {marker}")
    require("/v2/ai/gemini/oauth/start" in backend, "iOS backend starts Gemini OAuth through Worker")
    require("Try Google Sign-In" in ai_view, "iOS Gemini UI exposes OAuth retry")
    for forbidden in ["client_secret =", "refresh_token =", "access_token ="]:
        require(forbidden not in ai_view, f"iOS UI does not expose {forbidden}")
    print("SUCCESS: Gemini OAuth restore guard passed.")


if __name__ == "__main__":
    main()
