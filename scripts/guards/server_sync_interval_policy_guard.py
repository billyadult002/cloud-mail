#!/usr/bin/env python3
"""Guard server-configurable sync interval policy."""

from pathlib import Path
import sys


ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "platform/cloud-mail/mail-worker/src/service/sync-policy-service.js"
GMAIL = ROOT / "platform/cloud-mail/mail-worker/src/service/gmail-imap-service.js"
API = ROOT / "platform/cloud-mail/mail-worker/src/api/cloudmail-v2-api.js"


def require(condition: bool, message: str) -> None:
    if not condition:
        print(f"FAIL: {message}")
        sys.exit(1)
    print(f"PASS: {message}")


def main() -> None:
    policy = POLICY.read_text(encoding="utf-8")
    gmail = GMAIL.read_text(encoding="utf-8")
    api = API.read_text(encoding="utf-8")
    print("SERVER_SYNC_INTERVAL_POLICY_GUARD")
    for marker in [
        "global_default_poll_interval_seconds",
        "gmail_poll_fallback_interval_seconds",
        "gmail_partial_sync_min_interval_seconds",
        "imap_poll_interval_seconds",
        "imap_idle_reissue_seconds",
        "account_override_poll_interval_seconds",
        "max_poll_interval_seconds",
        "min_poll_interval_seconds",
        "backoff_base_seconds",
        "backoff_max_seconds",
        "jitter_percent",
        "battery_saver_multiplier",
        "active_foreground_multiplier",
        "server_config_version",
        "last_sync_policy_refresh_at"
    ]:
        require(marker in policy + gmail, f"sync policy field present: {marker}")
    require("/internal/sync-policy" in api, "internal sync policy endpoint exists")
    require("user.email !== c.env.admin" in api, "sync policy endpoint is admin gated")
    require("syncPolicyService.load" in gmail, "scheduler loads server policy")
    require("effective_interval_seconds" in gmail, "scheduler records effective interval diagnostics")
    require("boundedNumber(" in gmail and "min_poll_interval_seconds" in gmail, "scheduler clamps intervals")
    require("jitteredSeconds" in policy, "jitter is implemented")
    require("backoffSeconds" in policy, "backoff is implemented")
    require("gmail_partial" in policy and "imap_idle" in policy, "Gmail partial and IMAP IDLE modes modeled")
    print("SUCCESS: server sync interval policy guard passed.")


if __name__ == "__main__":
    main()
