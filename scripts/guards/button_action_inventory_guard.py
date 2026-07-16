#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
VIEWS = ROOT / "files/GlassMail-project/GlassMail/Views"
REPORT = ROOT / "BUTTON_ACTION_INVENTORY_REPORT.md"

SCREENS = [
    "Inbox", "Mailbox Detail", "Email Detail", "Compose", "AI Center",
    "Accounts", "Account Center", "Settings", "Provider Detail",
    "Attachments / Preview",
]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("BUTTON_ACTION_INVENTORY_GUARD")
    source = "\n".join(path.read_text() for path in VIEWS.glob("*.swift"))
    controls = re.findall(r"\b(Button|NavigationLink|Menu|ToolbarItem|Toggle|Picker|ShareLink)\b|onTapGesture|swipeActions|contextMenu", source)
    require(len(controls) >= 80, "SwiftUI interactive controls are inventoried")
    require(REPORT.exists(), "button action inventory report exists")
    report = REPORT.read_text()
    for screen in SCREENS:
        require(screen in report, f"{screen} inventory is documented")
    for required in ["Translate", "Reply", "Forward", "Archive", "Delete", "Run Safe Test", "Send", "Refresh"]:
        require(required in report, f"{required} action is inventoried")
    print("SUCCESS: button action inventory guard passed.")


if __name__ == "__main__":
    main()
