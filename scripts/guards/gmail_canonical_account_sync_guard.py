#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
account_service = (root / "platform/cloud-mail/mail-worker/src/service/account-service.js").read_text()
v2_service = (root / "platform/cloud-mail/mail-worker/src/service/cloudmail-v2-service.js").read_text()
gmail_service = (root / "platform/cloud-mail/mail-worker/src/service/gmail-imap-service.js").read_text()

def require(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")

for source, name in [(account_service, "legacy account list"), (v2_service, "v2 accounts"), (gmail_service, "gmail auto sync")]:
    require("ROW_NUMBER() OVER" in source, f"{name} must rank duplicate Gmail accounts")
    require("LOWER(email)" in source or "LOWER(a.email)" in source, f"{name} must partition Gmail by normalized email")
    require("mailbox_ready" in source, f"{name} must prefer mailbox_ready Gmail accounts")
    require("oauth-json:%" in source, f"{name} must prefer OAuth Gmail credentials")

require("canonical_rank = 1" in account_service, "legacy account list must return only canonical Gmail rows")
require("canonical_rank = 1" in v2_service, "v2 accounts must return only canonical Gmail rows")
require("canonical_rank = 1" in gmail_service, "auto sync must sync only canonical Gmail rows")
print("PASS: gmail_canonical_account_sync_guard")
