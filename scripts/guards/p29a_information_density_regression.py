#!/usr/bin/env python3
"""P29A static guard for Mail OS header density."""

from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VIEWS = ROOT / "files/GlassMail-project/GlassMail/Views"


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        print(f"P29A_INFORMATION_DENSITY_FAIL: {message}")
        raise SystemExit(1)


components = read(VIEWS / "Components.swift")
inbox = read(VIEWS / "InboxView.swift")
dashboard = read(VIEWS / "MailOSDashboardView.swift")

require("struct CompactAccountPillView" in components, "CompactAccountPillView must exist")
for label in ["Switch Account", "Account Health", "Sync Status", "Settings"]:
    require(label in components, f"account pill menu must include {label}")
require("app.setMailbox(accountId:" in components, "account pill must reuse AppState mailbox switching")
require("Task { await app.refresh() }" in components, "account pill must expose sync refresh")

dashboard_call_count = sum(read(path).count("MailOSDashboardView(") for path in VIEWS.glob("*.swift"))
require(dashboard_call_count == 1, "full MailOSDashboardView must only be rendered once")
require("MailOSDashboardView(" in inbox, "Inbox root must retain the full Mail OS dashboard")
require("Mail OS control center" in dashboard, "full dashboard chrome must remain owned by MailOSDashboardView")

secondary_files = [
    "AIView.swift",
    "ComposeView.swift",
    "AccountsView.swift",
    "SettingsView.swift",
    "EmailDetailView.swift",
    "MailboxDetailView.swift",
    "CloudMailV2Views.swift",
]
for filename in secondary_files:
    require("CompactAccountPillView()" in read(VIEWS / filename), f"{filename} must use compact account pill")

require("CompactAccountPillView()" not in inbox, "Inbox root should not duplicate compact pill above full dashboard")

print("P29A_INFORMATION_DENSITY_PASS")
print("mail_os_dashboard_owner=InboxView")
print("secondary_header=CompactAccountPillView")
print("account_pill_menu=SwitchAccount_AccountHealth_SyncStatus_Settings")
