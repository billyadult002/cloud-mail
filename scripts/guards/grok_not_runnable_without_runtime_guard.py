#!/usr/bin/env python3
"""Guard Grok/Claude/Copilot from becoming runnable without runtime smoke evidence."""

from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[1]
AI_PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)
    print(f"PASS: {message}")


def provider_entry(provider_id: str, text: str) -> str:
    match = re.search(rf"AIProviderRegistryEntry\(\s*providerID: \.{provider_id},.*?\n\s*\)", text, flags=re.S)
    if not match:
        fail(f"missing provider entry: {provider_id}")
    return match.group(0)


def main() -> None:
    provider = AI_PROVIDER.read_text(encoding="utf-8")
    app_state = APP_STATE.read_text(encoding="utf-8")

    print("GROK_NOT_RUNNABLE_WITHOUT_RUNTIME_GUARD")
    for provider_id in ["grok", "claude", "copilot"]:
        block = provider_entry(provider_id, provider)
        require('"runtime_metadata": "missing"' in block, f"{provider_id} runtime metadata remains missing")
        require('"visible_in_action_picker": "false"' in block, f"{provider_id} hidden from action picker")
        require(f"providerID: .{provider_id}" in provider, f"{provider_id} remains registered for future support")

    require("case .claude, .copilot, .grok:" in provider, "unverified providers share unavailable status")
    require("return .unavailable" in provider, "unverified providers are unavailable")
    require("guard providerID == .gemini else" in app_state, "safe mail action execution has no silent fallback")

    print("SUCCESS: Grok/Claude/Copilot are not runnable without runtime smoke evidence.")


if __name__ == "__main__":
    main()
