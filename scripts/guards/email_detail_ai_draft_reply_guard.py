#!/usr/bin/env python3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Views" / "EmailDetailView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    text = DETAIL.read_text(encoding="utf-8")
    hub_start = text.find("private struct EmailAIActionHubView")
    draft_start = text.find("private struct EmailDraftReplyLiveView")
    ask_start = text.find("private struct EmailAskAILiveView")
    require(hub_start != -1 and draft_start != -1 and ask_start != -1, "AI action hub and draft page exist")
    hub = text[hub_start:draft_start]
    draft = text[draft_start:ask_start]

    print("EMAIL_DETAIL_AI_DRAFT_REPLY_GUARD")
    require('Label("Draft Reply with AI", systemImage: "wand.and.stars")' in hub, "AI Actions exposes Draft Reply with AI")
    require("NavigationLink" in hub and "EmailDraftReplyLiveView(email: email)" in hub, "Draft Reply opens a dedicated live page")
    require("app.draftReplyLocalStrict(for: email, guidance: nil)" in draft, "draft reply uses strict Apple local reply generation")
    require('LabeledContent("AI route", value: "Apple Intelligence")' in draft, "draft page shows Apple Intelligence route")
    require('LabeledContent("To", value:' in draft and 'LabeledContent("Subject", value:' in draft, "draft page shows reply context")
    require("Drafting locally with Apple Intelligence..." in draft, "draft page shows a running state")
    require("ProductSafeText.sanitize(draftText, context: .ai)" in draft, "draft page surfaces sanitized AI output")
    require("showCompose = true" in draft and ".sheet(isPresented: $showCompose)" in draft, "generated draft opens Compose sheet")
    require("original: email" in draft and "initialBody: draftText" in draft, "generated draft passes reply context into Compose")
    require('Label("Retry", systemImage: "arrow.clockwise")' in draft, "draft page has visible retry on failure")
    require(".task(id: runID)" in draft and "await run()" in draft, "draft page auto-runs on entry")
    print("SUCCESS: Email Detail AI draft reply guard passed.")


if __name__ == "__main__":
    main()
