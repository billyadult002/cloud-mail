#!/usr/bin/env python3
"""Guard preservation of recent backend audit fixes."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "platform/cloud-mail/mail-worker"


def read(path: str) -> str:
    return (WORKER / path).read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> int:
    outbound_test = read("scripts/reliability-tests/outbound_state.test.mjs")
    webs = read("src/hono/webs.js")
    outbound = read("src/service/outbound-service.js")
    email_service = read("src/service/email-service.js")
    email_js = read("src/email/email.js")
    telegram = read("src/api/telegram-api.js")
    print("BACKEND_AUDIT_FIX_PRESERVATION_GUARD")
    require("describe(" in outbound_test and "expect(" in outbound_test, "outbound_state Vitest tests are structured")
    require((WORKER / "src/api/test-api.js").exists(), "src/api/test-api.js exists")
    require("import '../api/test-api'" in webs, "webs.js registers test-api.js")
    require("createdRow" in outbound and "last_row_id" in outbound, "outbound claim returns created row")
    require("delegatedMailboxAuthorization" in email_service and "mailOwnerUserId" in email_service, "email latest supports delegated mailbox owner resolution")
    require("email.from?.address" in email_js and "email.from?.name" in email_js, "email.from safeguard preserved")
    require("Cache-Control" in telegram and "no-store" in telegram and "Pragma" in telegram, "telegram dynamic content no-cache headers preserved")
    print("SUCCESS: backend audit fix preservation guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
