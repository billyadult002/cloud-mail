#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "REAL_USE_NEXT_GROUP_AI_DRAFT_ASK_REPLY_FORWARD_SAFE_ACTIONS_FINAL_REPORT.md"
GUARDS = ROOT / "scripts/guards"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    report = REPORT.read_text(encoding="utf-8")
    print("AI_REAL_USE_PREVIOUS_PASS_PRESERVATION_GUARD")
    require("CLOUDMAIL_REAL_USE_TESTING_CHECKLIST_NEXT_GROUP_AI_DRAFT_ASK_REPLY_FORWARD_SAFE_ACTIONS_COMPLETED" in report, "AI/reply/forward final PASS report preserved")
    require("AI Draft Reply with AI: PASS" in report, "AI draft reply PASS preserved")
    require("Ask AI: PASS" in report, "Ask AI PASS preserved")
    require("Reply Compose context: PASS" in report and "Forward Compose context: PASS" in report, "reply/forward PASS preserved")
    for name in [
        "email_detail_auto_summary_on_open_guard.py",
        "email_detail_ai_draft_reply_guard.py",
        "email_detail_ask_ai_guard.py",
        "email_detail_reply_compose_context_guard.py",
        "email_detail_forward_compose_context_guard.py",
        "safe_mail_actions_action_first_real_use_guard.py",
    ]:
        require((GUARDS / name).exists(), f"{name} preserved")
    print("SUCCESS: AI real-use previous PASS preservation guard passed.")


if __name__ == "__main__":
    main()
