#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

def require(path: str, needles: list[str], label: str) -> None:
    text = (ROOT / path).read_text()
    missing = [needle for needle in needles if needle not in text]
    if missing:
        raise SystemExit(f"FAIL: {label}: missing {', '.join(missing)}")
    print(f"PASS: {label}")

require("files/GlassMail-project/GlassMail/Views/MainTabView.swift", [
    'title: "Email"', 'title: "Intelligence"', 'title: "Work"',
    'title: "Trust"', 'title: "Organization"', "WorkCenterView", "OrganizationCenterView"
], "five-system ownership navigation")
require("files/GlassMail-project/GlassMail/Views/MobileWorkspaceView.swift", [
    "[.briefing, .health, .output, .run]", "briefingButton", "selectedMailboxHealth", "showSecurityCenter"
], "AI workspace ownership and KPI drill-down")
require("files/GlassMail-project/GlassMail/Views/InboxView.swift", [
    "selectionBottomBar", "Classify message", "applyClassification", "classificationUndoBanner",
    "Summarize Thread", "Create Follow Up", "Create Mission", "Draft Reply With AI",
    "Create Customer Brief", "Create Meeting Brief", "Move To Queue", "Trust Analysis",
    "Create Brief", "Create Report", "Create Deliverable", "Follow-Up Campaign",
    "Assign Priority", "Assign Customer"
], "selection, classification and contextual workflows")
require("files/GlassMail-project/GlassMail/Views/ComposeView.swift", [
    "composeFromRow", "Choose sending identity", "Can send"
], "single-row Compose identity")
require("files/GlassMail-project/GlassMail/Views/SettingsView.swift", [
    "SecurityCenterMetric", "SecurityMetricDetailView", 'Button("Approve")', 'Button("Ignore")', 'Button("Block"'
], "security KPI drill-down and Gatekeeper")

ai = (ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift").read_text()
body = ai.split("var body: some View", 1)[1].split("private var safeActionPanel", 1)[0]
if "safeActionPanel" in body or "workspaceChat" in body:
    raise SystemExit("FAIL: duplicate AI action surfaces remain visible")
print("PASS: duplicate AI action surfaces removed from visible hierarchy")
print("SUCCESS: GPT65 workflow completeness guard passed.")
