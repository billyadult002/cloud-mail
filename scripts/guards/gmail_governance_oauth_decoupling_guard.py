#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
service = (root / "platform/cloud-mail/mail-worker/src/service/google-test-user-request-service.js").read_text()
platform = (root / "platform/cloud-mail/mail-worker/src/service/gmail-platform-v2-service.js").read_text()

def require(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")

require("cloudmailGovernance: 'auto_approved'" in service, "Governance state must be explicit")
require("googleOAuthState" in service, "Google OAuth state must be explicit and separate")
require("mailboxState" in service, "Mailbox state must be explicit and separate")
require("approved_reverted_to_pending" in platform, "Governance engine must track no approved-to-pending regressions")
print("PASS: gmail_governance_oauth_decoupling_guard")
