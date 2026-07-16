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
    ask_start = text.find("private struct EmailAskAILiveView")
    star_start = text.find("private struct EmailStarToggleLiveView")
    require(hub_start != -1 and ask_start != -1 and star_start != -1, "AI action hub and Ask AI page exist")
    hub = text[hub_start:ask_start]
    ask = text[ask_start:star_start]

    print("EMAIL_DETAIL_ASK_AI_GUARD")
    require('Label("Ask AI", systemImage: "sparkles.rectangle.stack")' in hub, "AI Actions exposes Ask AI")
    require("NavigationLink" in hub and "EmailAskAILiveView(email: email)" in hub, "Ask AI opens a dedicated live page")
    require('private let suggestions = [' in ask, "Ask AI page has prompt suggestions")
    require('"What is this email about?"' in ask and '"What should I do next?"' in ask, "Ask AI includes useful default prompts")
    require("Reading this email locally..." in ask, "Ask AI shows a running state")
    require("app.aiCompleteLocal(" in ask, "Ask AI uses local Apple AI completion")
    require("Subject: \\(email.displaySubject)" in ask and "From: \\(email.fromName)" in ask and "\\(email.plainBody)" in ask, "Ask AI prompt includes email context")
    require("ProductSafeText.sanitize(answer, context: .ai)" in ask, "Ask AI surfaces sanitized answer")
    require('Label("Retry", systemImage: "arrow.clockwise")' in ask, "Ask AI has visible retry on failure")
    require(".task(id: runID)" in ask and "await run()" in ask, "Ask AI auto-runs on entry")
    print("SUCCESS: Email Detail Ask AI guard passed.")


if __name__ == "__main__":
    main()
