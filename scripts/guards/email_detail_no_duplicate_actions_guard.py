#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DETAIL = ROOT / "files/GlassMail-project/GlassMail/Views/EmailDetailView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def section(text: str, start: str, end: str | None = None) -> str:
    start_index = text.index(start)
    if end is None:
        return text[start_index:]
    return text[start_index:text.index(end, start_index)]


def main() -> None:
    print("EMAIL_DETAIL_NO_DUPLICATE_ACTIONS_GUARD")
    detail = DETAIL.read_text()
    body = section(detail, "var body: some View", ".toolbar")
    toolbar = section(detail, ".toolbar", ".sheet(isPresented: $showCompose)")
    reply_bar = section(detail, "private var replyBar: some View", "    // MARK: Actions")

    require("EmailDetailAIWorkspaceView(" not in body, "legacy inline AI workspace is not duplicated in detail body")
    require("EmailDetailAICopilotView(" not in body, "legacy inline AI copilot is not duplicated in detail body")
    require('Label("Reply"' not in toolbar, "Reply primary action is not duplicated in top menu")
    require('Label("Draft reply with AI"' not in toolbar and 'Label("Draft Reply"' not in toolbar, "AI draft action is not duplicated in top menu")
    require('Label("Translate"' not in toolbar, "Translate action is only exposed through unified AI Actions")
    require(reply_bar.count('Label("Reply"') == 1, "bottom row has one Reply action")
    require(reply_bar.count('Label("Forward"') == 1, "bottom row has one Forward action")
    require(reply_bar.count('Label("AI Actions"') == 1, "bottom row has one unified AI Actions menu")
    print("SUCCESS: email detail duplicate action guard passed.")


if __name__ == "__main__":
    main()
