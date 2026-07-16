#!/usr/bin/env python3
"""Guard alistair/bill send identity recovery path."""
from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_STATE = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Services" / "AppState.swift"
COMPOSE = ROOT / "files" / "GlassMail-project" / "GlassMail" / "Views" / "ComposeView.swift"
V2_SERVICE = ROOT / "platform" / "cloud-mail" / "mail-worker" / "src" / "service" / "cloudmail-v2-service.js"
ACCOUNT_SERVICE = ROOT / "platform" / "cloud-mail" / "mail-worker" / "src" / "service" / "account-service.js"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")


def main() -> int:
    app_state = APP_STATE.read_text()
    compose = COMPOSE.read_text()
    v2 = V2_SERVICE.read_text()
    account_service = ACCOUNT_SERVICE.read_text()
    require("restoreActiveOwnedAccounts" in v2, "backend active-owned soft-delete repair is missing")
    require("status = 'active'" in v2 and "is_del = 1" in v2 and "is_del = 0" in v2, "backend repair is not constrained to active identities")
    require("restoreByIdForUser" in account_service, "account scoped restore helper is missing")
    require("accountRow.isDel" in v2 and "restoreByIdForUser" in v2, "activation does not restore existing soft-deleted account")
    require("var composeFromAddresses" in app_state, "compose address merge source is missing")
    require("unifiedAccounts.compactMap" in app_state, "unified send identities are not merged into compose source")
    require("ForEach(app.composeFromAddresses)" in compose, "Compose From picker does not use merged send identities")
    require("return app.canSend(from: fromAddress)" in compose, "Compose Send button does not enforce send capability")
    print("PASS: alistair/bill send identity recovery guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
