#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
REPORT = ROOT / "UNIFIED_ALL_MAIL_SEND_RECEIVE_SENT_OUTBOX_FINAL_REPORT.md"
BACKEND = ROOT / "files/GlassMail-project/GlassMail/Services/Backend.swift"
WEBS = ROOT / "platform/cloud-mail/mail-worker/src/hono/webs.js"
API = ROOT / "platform/cloud-mail/mail-worker/src/api/global-mail-ledger-api.js"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    report = REPORT.read_text(encoding="utf-8")
    backend = BACKEND.read_text(encoding="utf-8")
    webs = WEBS.read_text(encoding="utf-8")
    api = API.read_text(encoding="utf-8")
    print("UNIFIED_ALL_MAIL_PREVIOUS_PASS_PRESERVATION_GUARD")
    require("CLOUDMAIL_UNIFIED_ALL_MAIL_SEND_RECEIVE_REAL_IPHONE_PASS" in report, "Unified All Mail final PASS report preserved")
    require("/v2/mail/all" in backend + webs + api, "Global Message Ledger route/client preserved")
    require("121605" in report and "local sent ledger row" in report, "real iPhone All Mail search evidence preserved")
    require("inbound row" in report and "outbound row" in report, "All Mail inbound/outbound evidence preserved")
    require("ProviderAccepted != Delivered" in report, "delivery boundary evidence preserved")
    print("SUCCESS: Unified All Mail previous PASS preservation guard passed.")


if __name__ == "__main__":
    main()
