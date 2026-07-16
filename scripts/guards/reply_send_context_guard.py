#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"
COMPOSE = ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    detail = DETAIL.read_text(encoding="utf-8")
    compose = COMPOSE.read_text(encoding="utf-8")
    print("REPLY_SEND_CONTEXT_GUARD")
    require("startReply(withDraft: false)" in detail and "EmailComposeLaunchView" not in detail, "Reply opens compose directly with current email")
    require(
        "original: displayedEmail" in detail
        and "isForward: presentation.isForward" in detail
        and "EmailDetailComposePresentation" in detail,
        "Email Detail passes original reply context",
    )
    require("recipient = original.fromAddress" in compose, "Reply fills original sender")
    require('subject = s.lowercased().hasPrefix("re:") ? s : "Re: \\(s)"' in compose, "Reply fills Re subject")
    require("hasReplyIdentityMismatch" in compose, "Reply blocks mismatched sending identity")
    print("SUCCESS: Reply send context guard passed.")


if __name__ == "__main__":
    main()
