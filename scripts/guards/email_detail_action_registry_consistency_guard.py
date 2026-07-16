#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
REGISTRY = ROOT / "files/GlassMail-project/GlassMail/Models/ActionRegistry.swift"

REQUIRED = {
    "back", "archive", "delete", "reply", "reply_all", "forward",
    "mark_read_unread", "star_unstar", "move", "more", "ai_actions",
    "ai_summary", "translate", "draft_reply", "ask_ai", "copy", "share",
    "open_attachment", "open_sender",
}


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("EMAIL_DETAIL_ACTION_REGISTRY_CONSISTENCY_GUARD")
    detail = DETAIL.read_text()
    registry = REGISTRY.read_text()
    ids = re.findall(r'actionID: "([^"]+)"', detail)
    require("CloudMailActionDescriptor" in registry, "shared action descriptor exists")
    require("registeredEmailDetailActions" in detail, "Email Detail has a local action map")
    require(not (REQUIRED - set(ids)), f"required action IDs are registered: {sorted(REQUIRED)}")
    duplicates = sorted({action_id for action_id in ids if ids.count(action_id) > 1})
    require(not duplicates, f"registered action IDs are unique: {duplicates}")
    require('actionID: "ai_actions"' in detail and 'resultDestination: .inlineCard' in detail, "unified AI Actions is represented in registry")
    require('actionID: "translate"' in detail and 'providerCapabilityRequired: "translation"' in detail, "Translate capability is registry-backed")
    print("SUCCESS: email detail action registry consistency guard passed.")


if __name__ == "__main__":
    main()
