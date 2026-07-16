#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INBOX = ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift"
APP = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    inbox = INBOX.read_text(encoding="utf-8")
    app = APP.read_text(encoding="utf-8")
    print("OUTBOX_ALL_MAIL_LEDGER_GUARD")
    require("UnifiedLocalLedgerItem" in inbox, "local ledger rows exist in All Mail/Inboxes UI")
    require("case .outbox(let message)" in inbox, "Outbox messages participate in local ledger actions")
    require("app.outboxMessages" in inbox, "Outbox messages are rendered from the unified local store")
    require("persistCodableForCurrentUser(outboxMessages" in app, "Outbox messages persist per user")
    require("-CloudMailInboxQuery" in inbox, "real-device All Mail search regression hook exists")
    require("-CloudMailOutboxQuery" in inbox, "real-device Outbox search hook exists")
    print("SUCCESS: Outbox All Mail/local ledger guard passed.")


if __name__ == "__main__":
    main()
