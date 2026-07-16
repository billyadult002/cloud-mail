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
    print("EMAIL_DETAIL_AUTO_SUMMARY_ON_OPEN_GUARD")
    require("startAutomaticBriefingIfReady()" in text, "automatic briefing helper exists")
    require("scheduleAutomaticBriefingStart()" in text, "automatic briefing retry scheduler exists")
    require("@State private var automaticBriefingStarterTask" in text, "automatic briefing scheduler state exists")
    require("private var canAutoStartBriefing: Bool" in text, "automatic briefing has consent-based start gate")
    require("private var openingSummaryText: String" in text, "Email Detail has immediate opening summary text")
    require('value: "Summary shown automatically on open."' in text, "idle result reports automatic summary on open")
    require('Text(openingSummaryText)' in text, "idle AI card renders summary immediately")
    require("Summary starts automatically" not in text, "idle AI card does not show waiting copy")
    require("guard canGenerateBriefing || canAutoStartBriefing else { return }" in text, "automatic briefing does not wait on readiness UI state")
    require(".task(id: appleBriefingCacheKey)" in text, "AI briefing card starts automatic summary on appearance")
    require("automaticBriefingKickView" in text, "visible AI card has direct automatic briefing kick view")
    require("kickAutomaticBriefingFromVisibleCard()" in text, "visible AI card directly schedules automatic briefing")
    require("briefingAutoRunKey == autoRunKey" not in text, "automatic summary is not blocked by stale autorun key")
    require(".onChange(of: localAIReady)" in text, "readiness change retriggers automatic summary")
    require(".onChange(of: displayedEmail.emailId)" in text, "message changes retrigger automatic summary")
    require("runBriefing(source: .auto, force: false)" in text, "automatic summary uses auto briefing route")
    task_block = text[text.find(".task {"):text.find(".onAppear {")]
    require("startAutomaticBriefingIfReady()" in task_block, "task starts automatic summary")
    require(task_block.find("startAutomaticBriefingIfReady()") < task_block.find("await app.analyzeSecurity(displayedEmail)"), "automatic summary starts before security analysis")
    require('if source == .auto {\n                return\n            }' in text, "auto route waits instead of surfacing manual error while readiness loads")
    idle_section = text[text.find("Summary starts automatically"):text.find("// MARK: Truth layer")]
    require('Label("Generate", systemImage: "sparkles")' not in idle_section, "idle AI card does not ask the user to press Generate")
    require('Label("Generate", systemImage: "sparkles")' not in text, "Email Detail does not show a manual Generate button")
    print("SUCCESS: Email Detail auto summary on open guard passed.")


if __name__ == "__main__":
    main()
