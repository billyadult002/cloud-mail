#!/usr/bin/env python3
"""Guard ChatGPT UI text for the Owner Mac Local AI Broker model."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
AI_PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
SETTINGS = ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift"
OPENAI_PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/OpenAIProvider.swift"


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)
    print(f"PASS: {message}")


def main() -> None:
    combined = "\n".join(path.read_text(encoding="utf-8") for path in [AI_PROVIDER, AI_VIEW, SETTINGS, OPENAI_PROVIDER])

    print("CHATGPT_LOCAL_BROKER_UI_TEXT_GUARD")
    for snippet in [
        "ChatGPT Local Broker",
        "Owner Mac + Codex CLI",
        "Pair Owner Mac",
        "ownerMacBrokerURL",
        "owner_mac_local_broker",
        "chatgpt_codex_cli",
        "local_only",
        "requires_owner_mac_online",
        "pairing_required",
        "transport_auth_required",
        "CloudMail never reads token files",
        "browser cookies",
        "refresh tokens",
        "Direct cloud account execution is not enabled",
    ]:
        require(snippet in combined, f"ChatGPT local broker truth present: {snippet}")

    for snippet in [
        "Account sign-in",
        "ChatGPT account sign-in is not available in this build",
        "auth.openai.com",
        "openai_access_token",
        "openai_refresh_token",
    ]:
        require(snippet not in combined, f"obsolete or unsafe ChatGPT text absent: {snippet}")

    print("SUCCESS: ChatGPT local broker UI text guard passed.")


if __name__ == "__main__":
    main()
