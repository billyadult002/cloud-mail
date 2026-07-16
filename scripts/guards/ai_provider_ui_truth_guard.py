#!/usr/bin/env python3
"""Guard AI Provider UI truth after Gemini 403 and local broker cleanup."""

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[2]
AI_PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
SETTINGS = ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift"


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)
    print(f"PASS: {message}")


def read(path: Path) -> str:
    if not path.exists():
        fail(f"missing file: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def main() -> None:
    provider = read(AI_PROVIDER)
    ai_view = read(AI_VIEW)
    settings = read(SETTINGS)
    all_text = "\n".join([provider, ai_view, settings])

    print("AI_PROVIDER_UI_TRUTH_GUARD")

    for field in [
        "runtime_mode",
        "connectable_now",
        "requires_pairing",
        "requires_owner_mac_online",
        "last_error_code",
        "last_error_message_redacted",
        "local_only",
        "visible_in_provider_list",
        "visible_in_action_picker",
        "action_picker_enabled",
    ]:
        require(re.search(rf"\bvar {field}\b", provider) is not None, f"contract field exists: {field}")

    for snippet in [
        "google_oauth_access_denied",
        "oauth_retry_enabled",
        "confirm this Google account is approved in the OAuth test-user list",
        "ChatGPT Local Broker",
        "Owner Mac + Codex CLI",
        "Pair Owner Mac",
        "authenticated Codex CLI",
        "visible_in_action_picker",
        "action_picker_enabled",
    ]:
        require(snippet in all_text, f"truth snippet present: {snippet}")

    forbidden = [
        "ChatGPT account sign-in is not available in this build",
        "Sign in available",
        "Sign in with Google to connect Gemini",
        "CloudMail will show it only when normal account authorization is ready",
        "OAuth blocked (403)",
        "Google tester access required",
        "billyadult006@gmail.com",
    ]
    for snippet in forbidden:
        require(snippet not in all_text, f"obsolete/misleading snippet removed: {snippet}")

    for secret_term in [
        "refresh_token",
        "access_token",
        "authorization_code",
        "client_secret",
        "browser cookie",
        "session reuse",
    ]:
        require(secret_term not in settings.lower(), f"settings UI does not expose {secret_term}")

    print("SUCCESS: AI provider UI truth guard passed.")


if __name__ == "__main__":
    main()
