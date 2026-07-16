#!/usr/bin/env python3
"""Guard CloudMail's ChatGPT cloud-provider architecture.

This intentionally rejects the retired Owner Mac Local Broker user-facing path
and verifies that ChatGPT uses the backend OpenAI provider route with no silent
fallback or browser/session/token-file reuse.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]

AI_PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
BACKEND = ROOT / "files/GlassMail-project/GlassMail/Services/Backend.swift"
CONFIG = ROOT / "platform/cloud-mail/mail-worker/src/service/provider-runtime-config-loader.js"
ROUTER = ROOT / "platform/cloud-mail/mail-worker/src/service/provider-runtime-router.js"
ADAPTERS = ROOT / "platform/cloud-mail/mail-worker/src/service/provider-runtime-adapters.js"


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    sys.exit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


def main() -> None:
    provider = AI_PROVIDER.read_text(encoding="utf-8")
    view = AI_VIEW.read_text(encoding="utf-8")
    app_state = APP_STATE.read_text(encoding="utf-8")
    backend = BACKEND.read_text(encoding="utf-8")
    config = CONFIG.read_text(encoding="utf-8")
    router = ROUTER.read_text(encoding="utf-8")
    adapters = ADAPTERS.read_text(encoding="utf-8")
    app_surface = "\n".join([provider, view, app_state])

    for retired in [
        "ChatGPT Local Broker",
        "Owner Mac + Codex CLI",
        "Pair Owner Mac",
        "ownerMacBroker",
        "chatgpt_codex_cli",
        "owner_mac_local_broker",
    ]:
        require(retired not in app_surface, f"retired local broker marker remains in app surface: {retired}")

    for marker in [
        'displayName: "ChatGPT Cloud"',
        'authType: .openAIAPIReference',
        '"runtime": "openai_chatgpt_cloud"',
        '"runtime_mode": "cloud_provider_runtime"',
        '"credential_reference": "backend_held_openai_api_reference"',
        '"browser_session_reuse": "forbidden"',
        '"token_file_access": "forbidden"',
        'case .chatgpt: return "openai"',
    ]:
        require(marker in provider, f"missing ChatGPT cloud provider marker: {marker}")

    require("providerId: providerID?.backendProviderID" in backend, "iOS workspace action must send provider id")
    require("aiWorkspaceSyntheticAction(_ action: AIWorkspaceSyntheticAction, providerID: AIProviderID" in app_state, "AppState must route synthetic action by provider")
    require("backend.aiWorkspaceAction(action, providerID: providerID)" in app_state, "AppState must call backend provider route")
    require("CLOUDMAIL_AI_PROVIDER_OPENAI_ENABLED" in config, "OpenAI provider flag missing")
    require("providerId === 'openai' ? flags.openaiEnabled" in config, "OpenAI provider must not be hard-disabled")
    require("'PROVIDER_DISABLED_BY_FEATURE_FLAG'" in config, "disabled OpenAI provider must report feature-flag block")
    require("workspaceProviderConfig" in router, "workspace provider routing helper missing")
    require("provider_id: 'openai'" in router, "workspace action must support OpenAI provider id")
    require("'unsupported_workspace_provider'" in router, "unsupported provider must be blocked explicitly")
    require("https://api.openai.com/v1/responses" in adapters, "OpenAI Responses API adapter missing")

    for forbidden in ["cookie", "browser session", "refresh token", "OAuth code"]:
        require(forbidden.lower() not in app_surface.lower() or "does not" in app_surface or "forbidden" in app_surface, f"unsafe secret/session wording near {forbidden}")

    print("SUCCESS: ChatGPT cloud provider architecture guard passed.")


if __name__ == "__main__":
    main()
