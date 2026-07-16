#!/usr/bin/env python3
"""Guard against ChatGPT/Codex token, cookie, and OAuth-code leakage."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TARGETS = [
    ROOT / "scripts" / "owner_mac_local_ai_broker.py",
    ROOT / "files" / "GlassMail-project" / "GlassMail" / "Services" / "AppState.swift",
    ROOT / "files" / "GlassMail-project" / "GlassMail" / "Views" / "AIView.swift",
]
FORBIDDEN_PATTERNS = [
    "open('/users",
    "read_text(",
    "document.cookie",
    "cookievalue",
    "cookie_value",
    "oauth_code =",
    "refresh_token =",
    "access_token =",
    "id_token =",
]


def main() -> int:
    failures: list[str] = []
    for path in TARGETS:
        source = path.read_text().lower()
        for needle in FORBIDDEN_PATTERNS:
            if needle not in source:
                continue
            failures.append(f"{path.relative_to(ROOT)} contains forbidden token/session access pattern: {needle}")
    if failures:
        raise SystemExit("FAIL:\n" + "\n".join(failures))
    print("PASS: ChatGPT broker code does not read or expose token files, cookies, OAuth codes, or raw tokens.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
