#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EMAIL_SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/email-service.js"
V2_SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/cloudmail-v2-service.js"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


print("ALL_MAIL_INCLUDES_AUTHORIZED_IDENTITIES_GUARD")
email_service = EMAIL_SERVICE.read_text(encoding="utf-8")
v2 = V2_SERVICE.read_text(encoding="utf-8")
require("FROM mailbox_authorizations" in email_service, "email list reads active mailbox authorizations")
require("owner_user_id" in email_service and "owner_account_id" in email_service, "authorized owner user/account scope is represented")
require("allReceiveMailboxScopeCondition" in email_service, "allReceive uses authorized identity scope helper")
require("JOIN account a ON a.account_id = ma.owner_account_id" in v2, "account list exposes delegated mailbox identities")
print("SUCCESS: Authorized identities are included in All Mail guard passed.")
