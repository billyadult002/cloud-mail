#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CLOUDMAIL_V2 = ROOT / "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift"
SETTINGS = ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
MAIN_TAB = ROOT / "files/GlassMail-project/GlassMail/Views/MainTabView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    v2 = CLOUDMAIL_V2.read_text()
    settings = SETTINGS.read_text()
    app_state = APP_STATE.read_text()
    main_tab = MAIN_TAB.read_text()
    print("EXECUTIVE_OS_MENU_GUARD")
    require("accountCenterSummaryStrip" in v2, "Account Center has compact summary strip")
    require("unavailableProviderDisclosure" in v2, "Unavailable providers are collapsed behind disclosure")
    require("connectedAccountsLedger" in v2, "Connected accounts use dense ledger")
    require(".truncationMode(.middle)" in v2, "Account Center email addresses use middle truncation")
    require("Image(systemName: \"ellipsis.circle\")" in v2, "Account rows use unified action menu")
    require("providerSummaryCard" in settings, "AI provider detail has compact summary card")
    require("providerActionCard" in settings, "AI provider detail has compact action card")
    require("providerCapabilityCard" in settings, "AI provider detail has compact capability card")
    require("providerMetadataCard" in settings, "AI provider detail has compact metadata card")
    require("settingsLaunchDestination" in app_state, "Settings supports validation launch destination state")
    require("-CloudMailSettingsDestination" in main_tab, "Settings validation launch argument is wired")
    require("account-center" in settings, "Account Center can be opened for real-device validation")
    print("SUCCESS: executive OS menu guard passed.")


if __name__ == "__main__":
    main()
