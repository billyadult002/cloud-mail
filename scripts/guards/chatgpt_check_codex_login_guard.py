#!/usr/bin/env python3
"""Guard real-iPhone Check Codex Login flow and signed broker auth-check."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BROKER = ROOT / "scripts" / "owner_mac_local_ai_broker.py"
APP_STATE = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Services" / "AppState.swift"
AI_VIEW = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Views" / "AIView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")


def main() -> int:
    broker = BROKER.read_text()
    app_state = APP_STATE.read_text()
    ai_view = AI_VIEW.read_text()
    require('self.path == "/auth/check"' in broker, "Broker /auth/check endpoint is missing")
    require("state.authenticate(pair_id, raw_body, signature, timestamp, nonce)" in broker, "/auth/check is not HMAC-authenticated")
    require("codex_health(deep=True)" in broker, "/auth/check does not run deep Codex health")
    require("func checkChatGPTCodexLogin()" in app_state, "AppState checkChatGPTCodexLogin is missing")
    require('path: "/auth/check"' in app_state, "AppState does not call /auth/check")
    require("ownerMacBrokerSignedRequest" in app_state, "Codex login check does not use signed broker request")
    require("checkChatGPTCodexLoginFromCard()" in ai_view, "AI card does not expose Check Codex Login action")
    require("CODEX_READY" in ai_view and "CODEX_READY" in app_state, "Codex-ready state is not wired")
    print("PASS: Check Codex Login uses signed broker auth-check and UI state is wired.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
