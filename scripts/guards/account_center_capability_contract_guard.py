#!/usr/bin/env python3
"""Guard Account Center consumes capability contract status."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACCOUNTS = ROOT / "files/GlassMail-project/GlassMail/Views/AccountsView.swift"
CLOUDMAIL_V2 = ROOT / "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift"
MODELS = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> int:
    accounts = ACCOUNTS.read_text(encoding="utf-8")
    v2 = CLOUDMAIL_V2.read_text(encoding="utf-8")
    models = MODELS.read_text(encoding="utf-8")
    print("ACCOUNT_CENTER_CAPABILITY_CONTRACT_GUARD")
    require("account.canSend" in accounts and "account.sendStatusReason" in accounts, "Accounts rows use account contract status")
    require("identityStatus(for:" in accounts, "Account status is centralized")
    require("Unified sending identity" in accounts + v2, "owned unified identities are labeled as sending identities")
    require("Delegated mailbox" in accounts + v2, "delegated mailboxes keep receive-only wording when not send-authorized")
    require("Delegated sending identity" in accounts + v2, "send-authorized delegated mailboxes use sending wording")
    require("var accountCapabilityContract" in models, "UnifiedMailAccount owns capability contract")
    print("SUCCESS: Account Center capability contract guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
