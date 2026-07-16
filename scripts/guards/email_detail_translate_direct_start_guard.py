#!/usr/bin/env python3
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
EMAIL_DETAIL = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Views" / "EmailDetailView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    text = EMAIL_DETAIL.read_text(encoding="utf-8")
    queue_start = text.find("private func queueTranslation")
    queue_end = text.find("private var translationSourceText")
    run_start = text.find("private func runTranslation")
    run_end = text.find("private func toggleStarAction")
    queue_block = text[queue_start:queue_end]
    run_block = text[run_start:run_end]
    inline_start = text.find("private var translateInlineState")
    inline_end = text.find("private func inlineTranslateStatus")
    inline_block = text[inline_start:inline_end]
    begin_start = text.find("private func beginTranslateFlow")
    begin_end = text.find("private func queueTranslation")
    begin_block = text[begin_start:begin_end]
    reply_start = text.find("private var replyBar")
    reply_end = text.find("// MARK: Actions")
    reply_block = text[reply_start:reply_end]

    print("EMAIL_DETAIL_TRANSLATE_DIRECT_START_GUARD")
    require('"email-detail-translate-icon"' in reply_block and 'icon: "character.book.closed.fill"' in reply_block, "bottom bar exposes compact direct Translate icon")
    require("compactReplyBarLink(" in reply_block, "direct Translate uses compact action bar link")
    menu_start = reply_block.find("Menu {")
    menu_block = reply_block[menu_start:] if menu_start != -1 else ""
    require('Label("Translate", systemImage: "character.book.closed.fill")' not in menu_block, "AI Actions menu does not duplicate Translate")
    require("runTranslation(selectedTranslationLanguage)" in begin_block, "AI Actions Translate starts immediately")
    require("guard !aiActionPhase.isRunning else { return }" not in begin_block, "Translate flow does not block on stale running state")
    require("showTranslateLanguagePicker = true" not in begin_block, "AI Actions Translate does not require language picker first")
    require("aiActionPhase = .running(.translate)" in queue_block, "language selection shows translation running immediately")
    require("Task { @MainActor in" in queue_block and "runTranslation(language)" in queue_block, "language selection starts translation after sheet dismissal")
    require("pendingTranslationLanguage = language" not in queue_block, "language selection does not depend on sheet onChange")
    require("aiActionPhase = .running(.translate)" in run_block, "translation exposes running state")
    require("guard !aiActionPhase.isRunning else { return }" not in run_block, "translation runner restarts even after stale running state")
    require("guard canGenerateBriefing || canAutoStartBriefing else" in run_block, "translation runner accepts local consent gate")
    require("actionStatusMessage = \"Translating to \\(language.title)...\"" in run_block, "translation status message is visible")
    require("app.aiCompleteLocal(" in run_block, "translation uses local Apple route with fallback result")
    require("translationResult = EmailTranslationResult(" in run_block, "translation success creates result card")
    require("Translation ready. AI route: Apple Intelligence." in run_block, "translation success states Apple route")
    require("private var translateInlineState: some View" in text, "AI card renders translation state inline")
    require('Label("Translation · \\(translationResult.language.title)", systemImage: "character.book.closed.fill")' in inline_block, "inline translation result is visible in AI card")
    require("private var aiBriefingInlineActions: some View" in text, "AI Briefing card exposes inline Translate action")
    require(".buttonStyle(.borderedProminent)" in text, "inline Translate uses standard iOS prominent button")
    require('Label("Chinese", systemImage: "character.book.closed.fill")' in text, "AI Briefing card exposes direct Chinese translation")
    require('Label("System", systemImage: "globe")' in text, "AI Briefing card exposes direct system-language translation")
    require("EmailTranslationLiveView(email: displayedEmail, language: .chinese)" in text, "Chinese option opens live translation page")
    require("EmailTranslationLiveView(email: displayedEmail, language: .auto)" in text, "System option opens live translation page")
    require("private struct EmailTranslationLiveView" in text and "Translating with Apple Intelligence..." in text, "live translation page runs translation visibly")
    require("case auto" in text and 'case chinese = "zh"' in text, "translate keeps system language and Chinese")
    forbidden_languages = [
        'case english = "en"',
        'case japanese = "ja"',
        'case korean = "ko"',
        'case spanish = "es"',
        'case french = "fr"',
        'case german = "de"',
    ]
    for language in forbidden_languages:
        require(language not in text, f"translate removes extra language option {language}")
    print("SUCCESS: Email Detail translate direct start guard passed.")


if __name__ == "__main__":
    main()
