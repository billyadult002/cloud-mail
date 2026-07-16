#!/usr/bin/env python3
"""Guard that legacy account rows are not the only source of send truth."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
COMPOSE = ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> int:
    app = APP_STATE.read_text(encoding="utf-8")
    compose = COMPOSE.read_text(encoding="utf-8")
    print("LEGACY_ACCOUNT_ROW_NOT_SOURCE_OF_TRUTH_GUARD")
    require("var composeFromAddresses" in app, "merged compose source exists")
    require("unifiedAccounts.compactMap" in app, "unified accounts can hydrate missing legacy rows")
    require("restoredSendCapability" in app, "send capability uses unified contract when available")
    require("ForEach(app.composeFromAddresses)" in compose, "Compose picker uses merged source")
    print("SUCCESS: legacy account row source-of-truth guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
