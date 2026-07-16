#!/usr/bin/env python3
"""Guard alistair/bill owned account repair path without customer data access."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
V2 = ROOT / "platform/cloud-mail/mail-worker/src/service/cloudmail-v2-service.js"
ACCOUNT_SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/account-service.js"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
ACCOUNTS = ROOT / "files/GlassMail-project/GlassMail/Views/AccountsView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> int:
    v2 = V2.read_text(encoding="utf-8")
    account_service = ACCOUNT_SERVICE.read_text(encoding="utf-8")
    app = APP_STATE.read_text(encoding="utf-8")
    accounts = ACCOUNTS.read_text(encoding="utf-8")
    print("ALISTAIR_BILL_REAL_ACCOUNT_GUARD")
    require("restoreActiveOwnedAccounts" in v2, "active owned accounts are self-healed")
    require("LOWER(email) IN" in v2 and "email_identities" in v2 and "status = 'active'" in v2, "self-heal is constrained to active owned identities")
    require("restoreByIdForUser" in account_service and "account.userId" in account_service, "restore helper is user scoped")
    require("accountRow.isDel" in v2 and "restoreByIdForUser" in v2, "activation restores soft-deleted owned rows")
    require("composeFromAddresses" in app and "unifiedAccounts.compactMap" in app, "Compose source includes restored unified owned accounts")
    require("Unified sending identity" in accounts and "Delegated sending identity" in accounts and "Delegated mailbox" in accounts, "Accounts UI separates owned, delegated-send, and delegated-receive-only wording")
    require("1000000000 + ma.id" in v2 and "CAST(ma.owner_account_id AS TEXT) AS external_account_id" in v2, "delegated rows keep stable authorization id and readable owner account id")
    print("SUCCESS: alistair/bill real account guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
