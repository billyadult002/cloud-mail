#!/usr/bin/env python3
"""Run the concrete broker-context Codex exec and app-compatible smoke guards."""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BROKER = ROOT / "scripts" / "owner_mac_local_ai_broker.py"


def run_json(*args: str) -> dict:
    result = subprocess.run(args, cwd=ROOT, text=True, capture_output=True, timeout=120, check=False)
    if result.returncode != 0:
        raise SystemExit(f"FAIL: command failed: {' '.join(args)}\n{result.stderr}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"FAIL: invalid JSON from {' '.join(args)}: {exc}") from exc


def main() -> int:
    status = run_json("python3", str(BROKER), "status", "--provider", "chatgpt")
    if status.get("codex_auth_status") != "pass":
        raise SystemExit(f"FAIL: Codex auth status is not pass: {status.get('reason')}")
    if status.get("codex_exec_ready") is not True:
        raise SystemExit(f"FAIL: Codex exec probe is not ready: {status.get('reason')}")
    smoke = run_json("python3", str(BROKER), "app-smoke", "--provider", "chatgpt")
    if smoke.get("ok") is not True:
        raise SystemExit(f"FAIL: app-compatible broker smoke failed: {smoke}")
    if smoke.get("secret_exposure") is not False:
        raise SystemExit("FAIL: smoke reported secret exposure")
    print("PASS: ChatGPT broker Codex exec context and app-compatible smoke passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
