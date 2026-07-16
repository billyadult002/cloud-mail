#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
MODELS = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"
INBOX = ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift"
FINAL_REPORT = ROOT / "REAL_USE_SEND_RECEIVE_ATTACHMENTS_FINAL_REPORT.md"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    models = MODELS.read_text(encoding="utf-8")
    inbox = INBOX.read_text(encoding="utf-8")
    final = FINAL_REPORT.read_text(encoding="utf-8") if FINAL_REPORT.exists() else ""
    print("REAL_RECEIVE_VALIDATION_GUARD")
    require("case delivered" in models, "model can represent received-confirmed only when evidence exists")
    require("Provider accepted; delivery not confirmed" in inbox, "Sent UI keeps provider accepted separate from received")
    if "received_confirmed" in final:
        require("recipient mailbox observed" in final.lower() and "subject id" in final.lower(), "received_confirmed final report includes mailbox evidence")
    print("SUCCESS: Real receive validation guard passed.")


if __name__ == "__main__":
    main()
