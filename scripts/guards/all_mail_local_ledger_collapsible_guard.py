#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INBOX = ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift"
APP = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


print("ALL_MAIL_LOCAL_LEDGER_COLLAPSIBLE_GUARD")
inbox = INBOX.read_text(encoding="utf-8")
app = APP.read_text(encoding="utf-8")
require("@State private var expandedUnifiedLocalLedger = false" in inbox, "All Mail local ledger starts collapsed")
require("All Mail unified local ledger disclosure" in inbox, "All Mail local ledger has an explicit disclosure control")
require("!query.trimmingCharacters" in inbox and "Search results" in inbox, "search can reveal matching local ledger rows")
require("localLedgerDeleteButton(for:" in inbox, "local ledger rows expose management actions")
require("deleteOutboxMessage" in app and "deleteScheduledMessage" in app and "deleteSentMessage" in app, "local sent/outbox/scheduled rows can be removed")
print("SUCCESS: All Mail local ledger collapsible guard passed.")

