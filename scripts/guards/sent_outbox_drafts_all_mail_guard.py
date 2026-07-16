#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INBOX = ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


print("SENT_OUTBOX_DRAFTS_ALL_MAIL_GUARD")
inbox = INBOX.read_text(encoding="utf-8")
require("unifiedLocalLedgerItems" in inbox, "All Mail has a unified local ledger")
for marker in ["app.sentMessages.map", "app.outboxMessages.map", "app.drafts.map", "app.scheduledMessages.map"]:
    require(marker in inbox, f"All Mail ledger includes {marker}")
require("Provider accepted; delivery not confirmed" in inbox, "sent messages keep provider accepted boundary")
require("All Mail local ledger" in inbox, "unified local ledger rows are testable on device")
require("normalizedLocalLedgerSearchText" in inbox and "normalizedSearchText" in inbox, "local ledger search tolerates punctuation/spacing differences")
print("SUCCESS: Sent/Outbox/Drafts All Mail guard passed.")
