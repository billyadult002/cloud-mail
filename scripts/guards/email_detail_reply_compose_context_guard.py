#!/usr/bin/env python3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Views" / "EmailDetailView.swift"
COMPOSE = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Views" / "ComposeView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    detail = DETAIL.read_text(encoding="utf-8")
    compose = COMPOSE.read_text(encoding="utf-8")
    start = detail.find("private var replyBar")
    end = detail.find("// MARK: Actions")
    reply_bar = detail[start:end]

    print("EMAIL_DETAIL_REPLY_COMPOSE_CONTEXT_GUARD")
    require('"email-detail-reply-icon"' in reply_bar and 'icon: "arrowshape.turn.up.left.fill"' in reply_bar, "Email Detail exposes compact Reply icon")
    require("compactReplyBarButton" in reply_bar and "startReply(withDraft: false)" in reply_bar, "Reply opens Compose directly from Email Detail")
    require("EmailComposeLaunchView" not in detail, "Reply intermediate launch page is removed")
    require(
        ".sheet(item: $composePresentation)" in detail
        and "original: displayedEmail" in detail
        and "isReplyAll: presentation.isReplyAll" in detail
        and "isForward: presentation.isForward" in detail,
        "Email Detail owns stable Compose sheet with original message context",
    )
    require("recipient = original.fromAddress" in compose, "Compose reply fills original sender as recipient")
    require('let s = original.displaySubject' in compose and 'subject = s.lowercased().hasPrefix("re:") ? s : "Re: \\(s)"' in compose, "Compose reply fills Re subject")
    require("messageBody = initialBody" in compose, "Compose keeps supplied reply body")
    require("composerReadsOriginal" in compose and "original != nil" in compose, "Compose tracks original-message context for AI consent")
    print("SUCCESS: Email Detail Reply compose context guard passed.")


if __name__ == "__main__":
    main()
