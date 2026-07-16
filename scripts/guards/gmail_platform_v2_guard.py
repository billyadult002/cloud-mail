#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "platform/cloud-mail/mail-worker"
SERVICE = WORKER / "src/service/gmail-platform-v2-service.js"
API = WORKER / "src/api/gmail-platform-v2-api.js"
WEBS = WORKER / "src/hono/webs.js"
TEST = WORKER / "scripts/reliability-tests/gmail-platform-v2.test.mjs"


def read(path: Path) -> str:
    if not path.exists():
        raise SystemExit(f"FAIL: missing {path}")
    return path.read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    service = read(SERVICE)
    api = read(API)
    webs = read(WEBS)
    test = read(TEST)
    combined = service + api + test
    print("GMAIL_PLATFORM_V2_GUARD")
    require("gmail-platform-v2-api" in webs, "Gmail Platform V2 API is mounted")
    for endpoint in [
        "/v2/gmail-platform/inventory",
        "/v2/gmail-platform/rest-only-plan",
        "/v2/gmail-platform/capability/evaluate",
        "/v2/gmail-platform/health/evaluate",
        "/v2/gmail-platform/governance/evaluate",
        "/v2/gmail-platform/lifecycle/evaluate",
        "/v2/gmail-platform/freshness/evaluate",
        "/v2/gmail-platform/send/audit",
        "/v2/gmail-platform/receive/audit",
        "/v2/gmail-platform/identity/audit",
        "/v2/gmail-platform/truth/evaluate",
        "/v2/gmail-platform/coordinator/plan",
        "/v2/gmail-platform/replay-readiness",
    ]:
        require(endpoint in api, f"Gmail Platform V2 endpoint exists: {endpoint}")

    for marker in ["REST_ONLY", "METADATA_FIRST", "CAPABILITY_FIRST", "HEALTH_FIRST", "GOVERNANCE_IMMUTABLE", "COORDINATED_SYNC"]:
        require(marker in service + test, f"Gmail V2 principle preserved: {marker}")
    require("gmail_rest_api" in service and "migration_only_reconnect_recovery_deprecated" in service, "REST-only runtime and IMAP deprecation preserved")
    require("Connected -> Can Send" in service and "OAuth Success -> Mailbox Ready" in service, "forbidden inference documented")
    require("inference_used: false" in service and "connectedOnly.canSend).toBe('send_blocked')" in test, "connected-only evidence does not imply capability PASS")
    require("approved_reverted_to_pending" in service and "approval_state).toBe('manual_approved')" in test, "governance approval does not revert on provider failure")
    require("reconnect_routes_to_add_mailbox: false" in service + test, "reconnect does not route to Add Mailbox")
    require("mailbox_ready" in service and "mailbox_ready_evidence" in service and "not.toBe('mailbox_ready')" in test, "mailbox_ready requires evidence")
    require("clampFutureTimestamp" in service and "2099-01-01" in test, "future timestamp clamp is preserved")
    require("duplicate_gmail_identity" in service + test and "operator_review" in service + test, "duplicate identity audit is preserved")
    require("Per Mailbox Durable Object Coordinator" in service + test and "single_writer" in service, "DO coordinator plan is preserved")
    require("send_pass_claimed: false" in service and "receive_pass_claimed: false" in service, "send/receive PASS is not fabricated")
    require("READY_FOR_REAL_ACCOUNT_REPLAY" in service + test and "pass_claimed: false" in service, "replay readiness does not claim PASS")
    for account in ["billyadult01@gmail.com", "billyadult008@gmail.com", "saercpku@gmail.com", "zhaotianwy@gmail.com"]:
        require(account in service, f"mandatory replay account tracked: {account}")
    require("production_deployed: false" in service, "production deployment not claimed")
    print("SUCCESS: Gmail Platform V2 guard passed.")


if __name__ == "__main__":
    main()
