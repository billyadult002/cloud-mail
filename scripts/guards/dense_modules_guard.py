#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AI = ROOT / "files/GlassMail-project/GlassMail/Views/AIView.swift"
COMPOSE = ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift"
ACCOUNTS = ROOT / "files/GlassMail-project/GlassMail/Views/AccountsView.swift"
SETTINGS = ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    ai = AI.read_text()
    compose = COMPOSE.read_text()
    accounts = ACCOUNTS.read_text()
    settings = SETTINGS.read_text()

    print("DENSE_MODULES_GUARD")
    require("Label(\"Run\", systemImage: \"play.fill\")" in ai, "AI safe actions use compact run control")
    require("messages.prefix(1)" in ai, "AI assistant shows compact recent message only")
    require("GridItem(.adaptive(minimum: 108)" in ai, "AI quick actions use dense adaptive grid")

    require("ccBccCompactRow" in compose, "Compose uses compact CC/BCC row")
    require(".frame(minHeight: 118, maxHeight: 150)" in compose, "Compose message editor is compact")
    require("inlineAICommandBar" in compose and "aiSuggestionPreview" in compose, "Compose AI Assist remains expanded")

    require("visibleConnectedAccounts" in accounts, "Accounts supports visible mailbox subset")
    require("connectedAccounts.prefix(6)" in accounts, "Accounts first page is capped at 6 mailboxes")
    require("mailboxDenseRow" in accounts, "Accounts uses dense mailbox rows")

    require("SettingsPage" in settings, "Settings uses Essential/Advanced pages")
    require("case .essential" in settings and "case .advanced" in settings, "Settings has two-page structure")
    print("SUCCESS: dense modules guard passed.")


if __name__ == "__main__":
    main()
