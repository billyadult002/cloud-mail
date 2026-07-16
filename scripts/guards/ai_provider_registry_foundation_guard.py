#!/usr/bin/env python3
"""Guard the CloudMail AI Provider Registry foundation.

This is a static architecture check. It verifies registry structure, shared
contract/state/capability models, UI reuse, and token-safety boundaries without
touching production services or provider credentials.
"""

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
AI_PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"
SETTINGS = ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift"
ACCOUNTS = ROOT / "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"


def read(path: Path) -> str:
    if not path.exists():
        fail(f"Missing required file: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    sys.exit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)
    print(f"PASS: {message}")


def main() -> None:
    ai_provider = read(AI_PROVIDER)
    settings = read(SETTINGS)
    accounts = read(ACCOUNTS)
    app_state = read(APP_STATE)

    print("AI_PROVIDER_REGISTRY_FOUNDATION_GUARD")

    for token in [
        "enum AIProviderID",
        "enum AIProviderAuthType",
        "enum AIProviderConnectionStatus",
        "enum AIProviderCapability",
        "struct AIProviderHealth",
        "struct AIProviderContract",
        "struct AIProviderRegistryEntry",
        "enum AIProviderRegistry",
        "static let allProviders",
    ]:
        require(token in ai_provider, f"{token} exists")

    for provider in ["gemini", "chatgpt", "claude", "copilot", "grok"]:
        require(re.search(rf"\bcase {provider}\b", ai_provider) is not None, f"provider id registered: {provider}")
        require(f"providerID: .{provider}" in ai_provider, f"provider metadata centralized: {provider}")

    provider_entries = re.findall(r"AIProviderRegistryEntry\(", ai_provider)
    require(len(provider_entries) == 5, "registry has one entry per required provider")

    for field in [
        "provider_id",
        "provider_name",
        "auth_type",
        "status",
        "capabilities",
        "health",
        "last_refresh",
        "display_name",
        "future_metadata",
        "connect_action_available",
        "disconnect_action_available",
        "reconnect_action_available",
        "runtime_available",
        "usable_now",
        "status_reason",
        "oauth_metadata_available",
        "runtime_metadata_available",
        "last_smoke_result",
        "last_smoke_at",
        "safe_user_action_available",
    ]:
        require(re.search(rf"\bvar {field}\b", ai_provider) is not None, f"contract field exists: {field}")

    require('case oauth = "OAUTH"' in ai_provider, "primary auth model is OAUTH")
    require('case future = "FUTURE"' in ai_provider, "future auth extension is reserved")
    for status in ["NOT_CONNECTED", "CONNECTING", "CONNECTED", "TOKEN_EXPIRED", "RECONNECT_REQUIRED", "ERROR", "DISABLED", "UNAVAILABLE", "UNSUPPORTED"]:
        require(status in ai_provider, f"state machine value exists: {status}")

    for capability in ["chat", "mail_summary", "draft_reply", "translation", "mail_search", "safe_test", "thread_summary", "tone_rewrite", "future"]:
        require(capability in ai_provider, f"capability exists: {capability}")

    require("var aiProviderContracts: [AIProviderContract]" in app_state, "AppState exposes registry contracts")
    require("AIProviderRegistry.contracts" in app_state, "AppState uses centralized registry")

    for view in ["AIProviderManagementView", "AIProviderRow", "AIProviderStatusBadge", "AIProviderDetailView", "AIProviderCapabilityList", "AIProviderConnectionButton"]:
        require(f"struct {view}" in settings, f"provider UI exists: {view}")

    require("ForEach(app.aiProviderContracts)" in settings, "provider list renders from registry contracts")
    require("AIProviderManagementView()" in accounts, "Account Center links to provider management")
    require("func providerStatusRow" not in settings, "provider-specific Settings row implementation removed")
    require("runGeminiSafeProviderTest()" in settings, "Gemini safe synthetic test is exposed in provider detail")
    ai_view = read(ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift")
    require("AIWorkspaceProviderPicker" in ai_view, "AI Workspace provider picker exists")
    require("AIActionResultView" in ai_view, "AI action result view exists")

    for forbidden in [
        "access_token",
        "refresh_token",
        "client_secret",
        "authorization_code",
    ]:
        require(forbidden not in settings.lower(), f"provider UI does not expose {forbidden}")

    require("startGeminiOAuth()" in settings, "existing Gemini connect path preserved")
    require("disconnectGeminiOAuth()" in settings, "existing Gemini disconnect path preserved")
    require("provider.provider_id == .gemini" in settings, "future provider actions stay disabled by provider id")
    require("Project Alpha meeting moved from 2 PM to 4 PM" in read(ROOT / "platform/cloud-mail/mail-worker/src/service/provider-runtime-adapters.js"), "safe synthetic Project Alpha prompt exists")

    print("SUCCESS: AI Provider Registry foundation guard passed.")


if __name__ == "__main__":
    main()
