#!/usr/bin/env python3
from pathlib import Path
import re
import sys


ROOT = Path(__file__).resolve().parents[2]
VIEWS = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Views"
APP_STATE = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Services" / "AppState.swift"

FORBIDDEN_VIEW_PATTERNS = {
    "Gemini AI user path": r"\bGemini\b",
    "ChatGPT Local Broker user path": r"ChatGPT Local Broker|Local Broker|Owner Mac|Pair Owner Mac|broker pairing",
    "AI provider registry page": r"AI Providers|CloudAISetupView|AIProviderManagementView|GoogleOAuthTestingCommandCenterView",
    "Google AI authorization UX": r"Google OAuth|OAuth Eligible|Google Sync|Try Google Sign-In|Error 403|403 helper|test user|tester list|Google verification",
    "cloud AI processing UX": r"Cloud AI setup|Cloud AI processing|Allow Cloud AI|No allowed AI provider|Provider used",
}

REQUIRED_SNIPPETS = {
    VIEWS / "AIView.swift": [
        "CloudMail AI uses Apple Intelligence locally for supported mail actions.",
        "let workflowResult = await app.aiWorkspaceWorkflow(workflow)",
        'LabeledContent("AI route", value: "Apple Intelligence")',
    ],
    VIEWS / "SettingsView.swift": [
        'LabeledContent("AI architecture", value: "Apple Intelligence only")',
        "AI features run locally on this device with Apple Intelligence.",
        'LabeledContent("Active AI", value: "Apple Intelligence")',
    ],
    VIEWS / "InboxView.swift": [
        'Text("Apple Intelligence")',
        'Text("· Active · Local")',
    ],
    VIEWS / "ComposeView.swift": [
        "Apple Intelligence is ready.",
        "Apple Intelligence uses composer text only.",
        "Apple Intelligence uses \\(source) locally for this request.",
    ],
    APP_STATE: [
        'merged.cloudAIEnabled = false',
        'localOnlyConsent.cloudAIEnabled = false',
        'profile.uiPreferences[Self.cloudAIEnabledPreferenceKey] = "false"',
        'title: localReady ? "Apple Intelligence Active" : "Apple Intelligence Not Ready"',
    ],
}

FORBIDDEN_SNIPPETS = {
    VIEWS / "AIView.swift": [
        "app.runSafeProviderAction(providerID:",
        "geminiCard",
        "chatGPTCard",
        "AIWorkspaceProviderPicker",
    ],
    VIEWS / "InboxView.swift": [
        "aiProviderMenuButton",
        "preferredProvider =",
        "Cloud AI setup",
    ],
    VIEWS / "SettingsView.swift": [
        "AIProviderManagementView",
        "CloudAISetupView",
        "GoogleOAuthTestingCommandCenterView",
    ],
}

ALLOWED_FALSE_POSITIVE_FILES = {
    VIEWS / "EmailDetailAICopilotView.swift",
}


def fail(message: str) -> None:
    print(f"FAIL: {message}")
    sys.exit(1)


def read(path: Path) -> str:
    if not path.exists():
        fail(f"missing file: {path.relative_to(ROOT)}")
    return path.read_text(encoding="utf-8")


def scan_views() -> None:
    for swift_file in VIEWS.rglob("*.swift"):
        if swift_file in ALLOWED_FALSE_POSITIVE_FILES:
            continue
        text = read(swift_file)
        for label, pattern in FORBIDDEN_VIEW_PATTERNS.items():
            match = re.search(pattern, text, flags=re.IGNORECASE)
            if match:
                rel = swift_file.relative_to(ROOT)
                fail(f"{label} remains in {rel}: {match.group(0)!r}")


def check_required_snippets() -> None:
    for path, snippets in REQUIRED_SNIPPETS.items():
        text = read(path)
        for snippet in snippets:
            if snippet not in text:
                fail(f"required P30 snippet missing from {path.relative_to(ROOT)}: {snippet}")


def check_forbidden_snippets() -> None:
    for path, snippets in FORBIDDEN_SNIPPETS.items():
        text = read(path)
        for snippet in snippets:
            if snippet in text:
                fail(f"forbidden P30 snippet remains in {path.relative_to(ROOT)}: {snippet}")


def main() -> None:
    scan_views()
    check_required_snippets()
    check_forbidden_snippets()
    print("P30_APPLE_INTELLIGENCE_ONLY_AI_GUARD_PASS")


if __name__ == "__main__":
    main()
