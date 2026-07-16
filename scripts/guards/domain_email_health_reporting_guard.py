#!/usr/bin/env python3
"""Guard domain email health wording."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ACCOUNTS = ROOT / "files/GlassMail-project/GlassMail/Views/AccountsView.swift"
V2VIEWS = ROOT / "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> int:
    text = ACCOUNTS.read_text(encoding="utf-8") + V2VIEWS.read_text(encoding="utf-8")
    print("DOMAIN_EMAIL_HEALTH_REPORTING_GUARD")
    require("Not reported yet" not in text, "ambiguous Not reported yet wording removed")
    require("Health check pending" in text, "health check pending wording exists")
    require("Sync pending" in text or "sync pending" in text, "sync pending wording exists")
    require("Restored from account authorization" not in text, "authorization restore wording removed from Accounts UI")
    print("SUCCESS: domain email health reporting guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
