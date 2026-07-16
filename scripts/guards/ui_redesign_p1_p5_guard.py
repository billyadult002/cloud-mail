#!/usr/bin/env python3
"""Guard CloudMail UI redesign P1-P5 anchors."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        print(f"FAIL: {message}")
        sys.exit(1)
    print(f"PASS: {message}")


def main() -> int:
    inbox = read("files/GlassMail-project/GlassMail/Views/InboxView.swift")
    dashboard = read("files/GlassMail-project/GlassMail/Views/MailOSDashboardView.swift")
    detail_ai = read("files/GlassMail-project/GlassMail/Views/EmailDetailAICopilotView.swift")
    detail = read("files/GlassMail-project/GlassMail/Views/EmailDetailView.swift")
    compose = read("files/GlassMail-project/GlassMail/Views/ComposeView.swift")
    accounts = read("files/GlassMail-project/GlassMail/Views/AccountsView.swift")

    print("UI_REDESIGN_P1_P5_GUARD")
    require("InboxSmartGroup" in inbox and "Priority" in inbox and "People" in inbox and "Updates" in inbox, "Inbox has smart grouped sections")
    require("runtimeLine" in dashboard and "health.prefix(4)" in dashboard, "Mail OS dashboard is reduced by default")
    require("MailboxIdentityChip" in inbox and "Received by" in inbox and "receivingIdentityStrip" in detail, "Mailbox identity is explicit in rows and details")
    require("AI Brief" in detail_ai and "ScrollView(.horizontal" in detail_ai, "Email detail AI is inline and compact")
    require("aiSuggestionPreview" in compose and "Replace" in compose and "Insert" in compose and "/ai polish" in compose, "Compose AI uses inline command and preview")
    require("MailboxHealthDot" in accounts and "accountMetric(\"Auth\"" in accounts and "accountMetric(\"Send\"" in accounts, "Accounts health is status-first")
    print("SUCCESS: UI redesign P1-P5 guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
