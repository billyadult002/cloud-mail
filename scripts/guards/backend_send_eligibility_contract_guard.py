#!/usr/bin/env python3
"""Guard backend send eligibility and contract alignment."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMAIL = ROOT / "platform/cloud-mail/mail-worker/src/service/email-service.js"
V2 = ROOT / "platform/cloud-mail/mail-worker/src/service/cloudmail-v2-service.js"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> int:
    email = EMAIL.read_text(encoding="utf-8")
    v2 = V2.read_text(encoding="utf-8")
    print("BACKEND_SEND_ELIGIBILITY_CONTRACT_GUARD")
    require("accountRow.userId !== userId" in email, "backend verifies sender ownership")
    require("sendCapableProviders" in email and "gmail" in email and "cloudflare_native" in email, "backend has provider send allowlist")
    require("send_scope_missing" in email and "Reconnect required for send" in email, "backend blocks missing send scope")
    require('"backend_send_eligibility":true' in v2 and '"backend_send_eligibility":false' in v2, "V2 contract mirrors backend eligibility")
    require('"compose_enabled":true' in v2 and '"compose_enabled":false' in v2, "V2 contract exposes compose enablement")
    print("SUCCESS: backend send eligibility contract guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
