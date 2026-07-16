#!/usr/bin/env python3
"""Guard Account Capability Contract V2 authoritative structure."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
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
    print("ACCOUNT_CAPABILITY_CONTRACT_V2_FINAL_GUARD")
    
    # Contract V2 final validation
    require('"contract_version":2' in worker, "Worker V2 contract enabled")
    require("account_capability_contract_v2" in worker, "Worker exposes account_capability_contract_v2")
    
    # Required ownership & authorization types
    require("OWNED" in worker and "DELEGATED" in worker, "Worker models OWNED and DELEGATED ownership types")
    
    # Swift modeling properties
    for field in [
        "contractVersion",
        "accountID",
        "providerType",
        "accountOwnershipType",
        "authType",
        "tokenReferencePresent",
        "sendScopePresent",
        "receiveScopePresent",
        "providerSendSupported",
        "providerReceiveSupported",
        "delegatedAuthorization",
        "restoredFromAuthorization",
        "canReceive",
        "canSend",
        "sendUnavailableReason",
        "receiveUnavailableReason",
        "accountHealth",
        "uiSendStatus",
        "backendSendEligibility",
        "composeEnabled"
    ]:
        require(field in models, f"iOS decodes field: {field}")
        
    print("SUCCESS: Account Capability Contract V2 final guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
