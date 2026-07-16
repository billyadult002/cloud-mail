#!/usr/bin/env python3
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    print("EMAIL_DETAIL_ACTION_MAP_GUARD")
    detail = DETAIL.read_text()
    ids = re.findall(r'actionID: "([^"]+)"', detail)
    require(len(ids) >= 19, "Email Detail action map covers primary, secondary, AI, and utility actions")
    for action_id in ["reply", "forward", "ai_actions", "translate", "draft_reply", "ask_ai"]:
        require(action_id in ids, f"{action_id} is mapped")
    require("resultDestination: .sheet" in detail, "sheet destinations are declared")
    require("resultDestination: .inlineCard" in detail, "inline result destinations are declared")
    require("resultDestination: .toast" in detail, "toast/result destinations are declared")
    print("SUCCESS: email detail action map guard passed.")


if __name__ == "__main__":
    main()
