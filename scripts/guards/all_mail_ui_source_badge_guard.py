#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INBOX = ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


print("ALL_MAIL_UI_SOURCE_BADGE_GUARD")
inbox = INBOX.read_text(encoding="utf-8")
require("MailboxIdentityChip(email: email)" in inbox, "inbound rows show received-by source mailbox")
require("Received by" in inbox, "source mailbox badge has visible source text")
require("subtitle: \"Sent · To:" in inbox, "outbound local ledger rows expose direction")
require("subtitle: \"Outbox · To:" in inbox, "outbox local ledger rows expose status source")
require("subtitle: \"Draft · To:" in inbox, "draft ledger rows expose draft state")
require("return folderScoped.filter { email in" in inbox, "search runs across the mailbox scope instead of the active chip")
print("SUCCESS: All Mail UI source badge guard passed.")
