#!/usr/bin/env python3
"""Guard Account Capability Contract V2 across Worker and iOS."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "platform/cloud-mail/mail-worker/src/service/cloudmail-v2-service.js"
MODELS = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> int:
    worker = WORKER.read_text(encoding="utf-8")
    models = MODELS.read_text(encoding="utf-8")
    print("ACCOUNT_CAPABILITY_CONTRACT_V2_GUARD")
    require('"contract_version":2' in worker, "Worker emits contract_version 2")
    require("account_capability_contract_v2" in worker, "Worker exposes account_capability_contract_v2")
    for marker in [
        "backend_send_eligibility",
        "compose_enabled",
        "send_unavailable_reason",
        "delegated_send_authorized",
        '"account_ownership_type":"OWNED"',
        '"account_ownership_type":"DELEGATED"',
    ]:
        require(marker in worker, f"Worker V2 marker present: {marker}")
    require("accountCapabilityContractV2Json" in models, "iOS decodes V2 contract field")
    require("contractVersion" in models and "AccountCapabilityContract" in models, "iOS contract carries version")
    require("backend_send_eligibility" in models and "compose_enabled" in models, "iOS gates send on backend eligibility and compose flag")
    require("send_unavailable_reason" in models, "iOS consumes V2 unavailable reason")
    require("delegated_send_authorized" in models, "iOS consumes explicit delegated-send permission")
    print("SUCCESS: Account Capability Contract V2 guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
