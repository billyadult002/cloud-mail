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

    print("EMAIL_DETAIL_FORWARD_COMPOSE_CONTEXT_GUARD")
    require('"email-detail-forward-icon"' in reply_bar and 'icon: "arrowshape.turn.up.right.fill"' in reply_bar, "Email Detail exposes compact Forward icon")
    require("compactReplyBarButton" in reply_bar and "startForward()" in reply_bar, "Forward opens Compose directly from Email Detail")
    require("EmailComposeLaunchView" not in detail, "Forward intermediate launch page is removed")
    require(
        ".sheet(item: $composePresentation)" in detail
        and "original: displayedEmail" in detail
        and "isForward: presentation.isForward" in detail,
        "Email Detail owns stable Compose sheet",
    )
    require('original == nil ? "New message" : (isForward ? "Forward" : "Reply")' in compose, "Forward Compose title is not mislabeled as Reply")
    require("recipient = \"\"" in compose, "Forward leaves recipient empty")
    require('subject = s.lowercased().hasPrefix("fwd:") ? s : "Fwd: \\(s)"' in compose, "Forward fills Fwd subject")
    require("----- Forwarded Message -----" in compose, "Forward includes forwarded message body")
    require("From: \\(original.fromName) <\\(original.fromAddress)>" in compose and "Date: \\(original.date?.formatted()" in compose, "Forward includes source metadata")
    print("SUCCESS: Email Detail Forward compose context guard passed.")


if __name__ == "__main__":
    main()
