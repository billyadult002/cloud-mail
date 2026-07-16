#!/usr/bin/env python3
"""Guard that ChatGPT remains smoke-gated through the Owner Mac Local Broker."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

AI_PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
SETTINGS_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift"
WORKER_CONFIG = ROOT / "platform/cloud-mail/mail-worker/src/service/provider-runtime-config-loader.js"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


provider = read(AI_PROVIDER)
app_state = read(APP_STATE)
ai_view = read(AI_VIEW)
settings = read(SETTINGS_VIEW)
worker = read(WORKER_CONFIG)

require('displayName: "ChatGPT Local Broker"' in provider, "ChatGPT display name must show Local Broker state")
require('"runtime": "chatgpt_codex_cli"' in provider, "ChatGPT registry must use the Codex CLI adapter")
require('"pairing_required": "true"' in provider, "ChatGPT registry must require Owner Mac pairing")
require('"usable_requires_broker_smoke": "true"' in provider, "ChatGPT must remain smoke-gated")
require("hasBrokerSmokeEvidence" in provider, "ChatGPT usability must depend on smoke evidence")
require("Owner Mac Local Broker" in provider, "Provider guidance must describe Owner Mac Local Broker")
require("CloudMail never reads browser sessions, cookies, token files, OAuth codes, or refresh tokens" in provider, "Provider guidance must prohibit secret/session access")
require("Requires paired Owner Mac before ChatGPT Local Broker can run." in app_state, "AppState must block unpaired ChatGPT broker use")
require("ChatGPT Owner Mac Local Broker signed smoke is running." in app_state, "AppState must run signed broker smoke")
require("provider_id: \"chatgpt\"" in app_state, "AppState must send ChatGPT broker provider id")
require("adapterID == \"chatgpt_codex_cli\"" in app_state, "AppState must validate the Codex CLI adapter")
require("ChatGPT Owner Mac Local Broker app-compatible signed smoke passed." in app_state, "AppState must require app-compatible smoke PASS")

for forbidden in [
    "browser_session_value",
    "cookies.sqlite",
]:
    require(forbidden not in provider + app_state + ai_view + settings, f"forbidden ChatGPT fallback marker absent: {forbidden}")

print("SUCCESS: ChatGPT local broker smoke-gated guard passed.")
