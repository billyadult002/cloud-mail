#!/usr/bin/env python3
"""Guard Compose From picker uses unified send identities."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
COMPOSE = ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> int:
    compose = COMPOSE.read_text(encoding="utf-8")
    app = APP_STATE.read_text(encoding="utf-8")
    print("COMPOSE_FROM_UNIFIED_IDENTITY_GUARD")
    require("composeFromAddresses" in app, "AppState exposes composeFromAddresses")
    require("guard account.canSend" in app, "Compose source includes only capability-approved send identities")
    require("delegated_send_authorized" in (ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift").read_text(encoding="utf-8"), "delegated send requires explicit authorization")
    require("readableAccountId" in app, "synthetic compose rows use readable backend account ids")
    require("ForEach(app.composeFromAddresses)" in compose, "From picker uses composeFromAddresses")
    require("app.canSend(from: fromAddress)" in compose, "Send button enforces capability")
    print("SUCCESS: compose unified identity guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
