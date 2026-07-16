#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INBOX = ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift"
DASHBOARD = ROOT / "files/GlassMail-project/GlassMail/Views/MailOSDashboardView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    inbox = INBOX.read_text()
    dashboard = DASHBOARD.read_text()
    print("INBOX_DENSE_SIX_GUARD")
    require(".navigationBarTitleDisplayMode(.inline)" in inbox, "Inbox uses inline title for first-screen density")
    require(".listRowSpacing(3)" in inbox, "Inbox list row spacing is compressed")
    require("SenderAvatar(name: email.fromName, size: 34)" in inbox, "Email rows use compact avatars")
    require(".glassCard(cornerRadius: 12)" in inbox, "Email rows use compact card radius")
    require("case .comfortable: return 7" in inbox, "Comfortable density row padding is compact")
    require("private var previewLineLimit: Int {\n        1\n    }" in inbox, "Email preview is constrained to one line")
    require("Routing active" not in dashboard[:dashboard.find("struct MailOSDashboardView")], "Mini Mail OS header removed dedicated routing row")
    require("Text(\"· \\(trust.visibleMessages) visible\")" in dashboard, "Mini Mail OS header uses single-line visible count")
    print("SUCCESS: inbox dense six guard passed.")


if __name__ == "__main__":
    main()
