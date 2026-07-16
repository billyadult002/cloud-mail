#!/usr/bin/env python3
"""Guard server sync policy integration with scheduler."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
GMAIL = ROOT / "platform/cloud-mail/mail-worker/src/service/gmail-imap-service.js"
INDEX = ROOT / "platform/cloud-mail/mail-worker/src/index.js"
WRANGLER = ROOT / "platform/cloud-mail/mail-worker/wrangler.toml"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> int:
    gmail = GMAIL.read_text(encoding="utf-8")
    index = INDEX.read_text(encoding="utf-8")
    wrangler = WRANGLER.read_text(encoding="utf-8")
    print("SERVER_SYNC_SCHEDULER_INTEGRATION_GUARD")
    require("syncPolicyService.load" in gmail, "Gmail sync loads server policy")
    require("effectiveForAccount" in gmail, "Gmail sync computes effective interval")
    require("effective_interval_seconds" in gmail, "Gmail sync records effective interval diagnostics")
    require("runAutomaticGmailSync" in index and "scheduled" in index, "scheduled sync entry point exists")
    require('*/30 * * * *' in wrangler, "production cron schedule remains configured")
    print("SUCCESS: server sync scheduler integration guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
