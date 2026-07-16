#!/usr/bin/env python3
"""Validate normal-user AI authorization UI truthfulness."""

from __future__ import annotations

import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
UI_FILES = [
    ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift",
    ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift",
    ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift",
]
CLIENT_PROVIDER_FILES = [
    ROOT / "files/GlassMail-project/GlassMail/AI/OpenAIProvider.swift",
    ROOT / "files/GlassMail-project/GlassMail/AI/GeminiProvider.swift",
]


def fail(message: str) -> None:
    print(f"FAIL: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    ui_text = "\n".join(path.read_text(encoding="utf-8") for path in UI_FILES)
    ai_view = UI_FILES[0].read_text(encoding="utf-8")
    provider_text = "\n".join(path.read_text(encoding="utf-8") for path in CLIENT_PROVIDER_FILES)

    required = [
        "Apple Intelligence",
        "Active (Local)",
        "Gemini",
        "Authorization required",
        "Try Google Sign-In",
        "ChatGPT Local Broker",
        "Owner Mac + Codex CLI",
        "Codex CLI login stays on the paired Mac",
        "Pair Owner Mac",
    ]
    missing = [snippet for snippet in required if snippet not in ai_view]
    if missing:
        fail(f"AI authorization UI missing truthful snippets: {missing}")

    forbidden_ui_patterns = [
        r"\bBYOK\b",
        r"\bAPI key\b",
        r"\bAPI Key\b",
        r"developer setup",
        r"model selector",
        r"ChatGPT account sign-in is not available in this build",
        r"Sign in available",
        r"Sign in with Google to connect Gemini",
        r"OAuth blocked \(403\)",
        r"Google tester access required",
    ]
    hits = []
    for pattern in forbidden_ui_patterns:
        if re.search(pattern, ui_text, flags=re.IGNORECASE):
            hits.append(pattern)
    if hits:
        fail(f"normal-user AI UI contains forbidden provider/setup language: {hits}")

    forbidden_client_runtime = [
        "openai_access_token",
        "openai_refresh_token",
        "x-goog-api-key",
        "generativelanguage.googleapis.com",
        "auth.openai.com",
        "Authorization",
        "Bearer ",
    ]
    runtime_hits = [snippet for snippet in forbidden_client_runtime if snippet in provider_text]
    if runtime_hits:
        fail(f"client-side cloud provider runtime path still present: {runtime_hits}")

    print("PASS: normal-user AI authorization UI is truthful and cloud provider client runtime paths are disabled.")


if __name__ == "__main__":
    main()
