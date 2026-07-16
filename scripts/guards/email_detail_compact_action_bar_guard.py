#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    text = DETAIL.read_text(encoding="utf-8")
    start = text.index("private var replyBar")
    end = text.index("// MARK: Actions", start)
    bar = text[start:end]

    print("EMAIL_DETAIL_COMPACT_ACTION_BAR_GUARD")
    require("compactReplyBarButton" in bar and "compactReplyBarLink" in bar, "reply bar uses compact direct buttons and icon links")
    for action_id in [
        "email-detail-reply-icon",
        "email-detail-forward-icon",
        "email-detail-draft-icon",
        "email-detail-ask-icon",
        "email-detail-translate-icon",
    ]:
        require(action_id in bar, f"compact action exists: {action_id}")
    require("startReply(withDraft: false)" in bar, "Reply opens Compose directly without an intermediate page")
    require("startForward()" in bar, "Forward opens Compose directly without an intermediate page")
    require("EmailComposeLaunchView" not in text, "Reply/Forward intermediate compose launch page is removed")
    require("EmailDraftReplyLiveView(email: displayedEmail)" in bar, "Draft is a direct compact action")
    require("EmailAskAILiveView(email: displayedEmail)" in bar, "Ask is a direct compact action")
    require("EmailTranslationLiveView(email: displayedEmail, language: .chinese)" in bar, "Translate remains direct")
    require('Label("Reply"' not in bar and 'Label("Forward"' not in bar and 'Label("Translate"' not in bar, "bottom action bar does not use large text labels")
    require(".frame(width: 38, height: 34)" in bar, "icon hit target is smaller and stable")
    require(".accessibilityLabel(title)" in bar, "icon-only actions retain accessibility labels")
    print("SUCCESS: Email detail compact action bar guard passed.")


if __name__ == "__main__":
    main()
