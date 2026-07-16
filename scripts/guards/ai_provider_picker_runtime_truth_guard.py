#!/usr/bin/env python3
"""Guard provider picker runtime truth."""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
PROVIDER = ROOT / "files/GlassMail-project/GlassMail/AI/AIProvider.swift"
AI_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    raise SystemExit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)
    print(f"PASS: {message}")


def entry(provider_id: str, text: str) -> str:
    match = re.search(rf"AIProviderRegistryEntry\(\s*providerID: \.{provider_id},.*?\n\s*\)", text, flags=re.S)
    if not match:
        fail(f"missing provider entry: {provider_id}")
    return match.group(0)


def main() -> None:
    provider = PROVIDER.read_text(encoding="utf-8")
    ai_view = AI_VIEW.read_text(encoding="utf-8")
    print("AI_PROVIDER_PICKER_RUNTIME_TRUTH_GUARD")
    require("providers.filter(\\.visible_in_action_picker)" in ai_view, "picker uses registry visibility")
    require("action_picker_enabled" in ai_view, "run button uses action enabled state")
    require('"visible_in_action_picker": "true"' in entry("gemini", provider), "Gemini may appear for OAuth retry/status")
    require('"visible_in_action_picker": "true"' in entry("chatgpt", provider), "ChatGPT Local Broker may appear")
    for provider_id in ["grok", "claude", "copilot"]:
        require('"visible_in_action_picker": "false"' in entry(provider_id, provider), f"{provider_id} is not runnable in picker")
        require('"runtime_metadata": "missing"' in entry(provider_id, provider), f"{provider_id} runtime metadata missing")
    print("SUCCESS: Provider picker runtime truth guard passed.")


if __name__ == "__main__":
    main()
