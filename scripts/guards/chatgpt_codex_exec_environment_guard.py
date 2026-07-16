#!/usr/bin/env python3
"""Guard ChatGPT Local Broker deterministic Codex exec environment."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BROKER = ROOT / "scripts" / "owner_mac_local_ai_broker.py"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")


def main() -> int:
    source = BROKER.read_text()
    require('DEFAULT_CODEX_BINARY = "/opt/homebrew/bin/codex"' in source, "Codex binary path is not deterministic")
    require("BROKER_PATH =" in source and "/opt/homebrew/bin" in source, "Broker PATH is not explicitly configured")
    require('env["HOME"]' in source and "CLOUDMAIL_OWNER_HOME" in source, "Broker HOME is not explicitly configured")
    require("cwd=str(REPO_ROOT)" in source, "Codex subprocess cwd is not pinned to the CloudMail repo")
    require("env=broker_env()" in source, "Codex subprocess does not use broker_env")
    require("last_codex_error_redacted" in source, "Codex failures are not redacted into diagnostics")
    print("PASS: ChatGPT Codex exec broker environment is deterministic and redacted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
