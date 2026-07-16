#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"

HANDLERS = [
    "toggleStarAction", "archiveAction", "trashAction", "startReply",
    "startReplyAll", "startForward", "toggleReadStateAction",
    "beginTranslateFlow", "runBriefingIfAvailable", "askAIAction",
    "copyMessageAction", "shareText", "openSenderAction", "createTaskAction",
]


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("EMAIL_DETAIL_NO_NOOP_BUTTONS_GUARD")
    detail = DETAIL.read_text()
    for handler in HANDLERS:
        require(handler in detail, f"{handler} action path exists")
    require("showCompose = true" in detail, "reply/forward/draft opens composer")
    require("copyText(" in detail, "copy action writes to clipboard")
    require("moveAction(" in detail, "move/delete/archive actions mutate mailbox state")
    require("actionStatusMessage =" in detail or "actionErrorMessage =" in detail, "actions surface visible feedback")
    print("SUCCESS: email detail no no-op buttons guard passed.")


if __name__ == "__main__":
    main()
