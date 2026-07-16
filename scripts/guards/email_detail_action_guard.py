#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
REGISTRY = ROOT / "files/GlassMail-project/GlassMail/Models/ActionRegistry.swift"
REPORT = ROOT / "EMAIL_DETAIL_ACTION_FIX_REPORT.md"

REQUIRED_ACTION_IDS = [
    "back", "archive", "delete", "reply", "reply_all", "forward",
    "mark_read_unread", "star_unstar", "move", "more", "ai_summary",
    "translate", "draft_reply", "ask_ai", "copy", "share",
    "open_attachment", "open_sender",
]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("EMAIL_DETAIL_ACTION_GUARD")
    detail = DETAIL.read_text()
    registry = REGISTRY.read_text()
    require("CloudMailActionDescriptor" in registry, "shared action descriptor exists")
    require("registeredEmailDetailActions" in detail, "Email Detail registers visible actions")
    for action_id in REQUIRED_ACTION_IDS:
        require(f'actionID: "{action_id}"' in detail, f"{action_id} action registered")
    for handler in ["archiveAction", "trashAction", "startReply", "startReplyAll", "startForward", "toggleReadStateAction", "beginTranslateFlow", "copyMessageAction"]:
        require(handler in detail, f"{handler} handler exists")
    require(REPORT.exists(), "Email Detail action fix report exists")
    print("SUCCESS: email detail action guard passed.")


if __name__ == "__main__":
    main()
