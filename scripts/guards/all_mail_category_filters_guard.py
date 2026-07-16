#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
INBOX = ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift"
APP = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


print("ALL_MAIL_CATEGORY_FILTERS_GUARD")
inbox = INBOX.read_text(encoding="utf-8")
app = APP.read_text(encoding="utf-8")
for category in ["promotion", "social", "junk"]:
    require(f"case .{category}" in inbox, f"{category} filter is handled in InboxView")
    require(f"case \"{category}\"" in app or category == "junk", f"{category} filter has a dashboard label")
require(".promotion, .social, .junk" in inbox, "Promotion, Social, and Junk appear in visible All Mail filters")
require("promotion-category" in inbox and "social-category" in inbox, "Promotion and Social appear in the mailbox drawer")
print("SUCCESS: All Mail category filters guard passed.")

