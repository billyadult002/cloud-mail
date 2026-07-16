#!/usr/bin/env python3
"""Guard compact CloudMail home Inbox architecture."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
INBOX = ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift"
DASH = ROOT / "files/GlassMail-project/GlassMail/Views/MailOSDashboardView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        print(f"FAIL: {message}")
        sys.exit(1)
    print(f"PASS: {message}")


def main() -> int:
    inbox = INBOX.read_text(encoding="utf-8")
    dash = DASH.read_text(encoding="utf-8")
    print("HOME_INBOX_MINI_HEADER_GUARD")
    require("MiniMailOSHeaderView" in dash, "Mini Mail OS header component exists")
    require("miniMailOSHeader(visibleEmails:" in inbox, "Inbox root uses Mini Mail OS header")
    require("mailOSDashboard(visibleEmails:" in inbox, "Full dashboard remains available for future expansion")
    require("safeAreaInset(edge: .bottom)" in inbox and "Color.clear.frame(height: 86)" in inbox, "Inbox reserves bottom tab bar safe area")
    require("Priority" in inbox and "People" in inbox and "Updates" in inbox, "Smart Inbox zones remain present")
    require("MailOSDashboardView(" in inbox, "Full Mail OS dashboard function is retained but not used as root default")
    print("SUCCESS: home inbox mini header guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
