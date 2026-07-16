#!/usr/bin/env python3
"""Guard CloudMail domain identity health/sync wording."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACCOUNTS = ROOT / "files/GlassMail-project/GlassMail/Views/AccountsView.swift"
V2VIEWS = ROOT / "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> int:
    accounts = ACCOUNTS.read_text(encoding="utf-8")
    v2 = V2VIEWS.read_text(encoding="utf-8")
    app = APP_STATE.read_text(encoding="utf-8")
    print("DOMAIN_EMAIL_SYNC_HEALTH_GUARD")
    require("Routing active" in accounts + v2 + app, "CloudMail domain identities have routing-active health label")
    require("account.displayProvider == .cloudflareNative" in accounts + v2 + app, "CloudMail native health path is provider-specific")
    require("Sync pending" in accounts + v2, "External/provider sync pending label remains available")
    require("Not reported yet" not in accounts + v2, "ambiguous Not reported yet wording remains removed")
    require("if account.displayProvider == .cloudflareNative { return \"Routing active\" }" in app, "health snapshot avoids permanent pending for CloudMail native")
    print("SUCCESS: domain email sync health guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
