#!/usr/bin/env python3
"""Guard explicit delegated_send_authorized metadata handling."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "platform/cloud-mail/mail-worker/src/service/cloudmail-v2-service.js"
MODELS = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        print(f"FAIL: {message}")
        sys.exit(1)
    print(f"PASS: {message}")


def main() -> int:
    worker = WORKER.read_text(encoding="utf-8")
    models = MODELS.read_text(encoding="utf-8")
    print("DELEGATED_SEND_AUTHORIZED_GUARD")
    require("delegated_send_authorized" in worker, "Worker exposes delegated_send_authorized capability")
    require("delegated_send_authorized" in models, "iOS models consume delegated_send_authorized")
    require("delegated_send_authorized" in models and "delegated_send_authorized" in worker, "delegated_send_authorized surfaced in contract")
    print("SUCCESS: delegated send authorized guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
