#!/usr/bin/env python3
"""Guard preservation of case-insensitive account deduplication fixes."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
IMAP = ROOT / "platform/cloud-mail/mail-worker/src/service/gmail-imap-service.js"
OAUTH = ROOT / "platform/cloud-mail/mail-worker/src/service/gemini-oauth-service.js"
ACCOUNTS = ROOT / "files/GlassMail-project/GlassMail/Views/AccountsView.swift"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"


def require(condition: bool, message: str) -> None:
    if not condition:
        print(f"FAIL: {message}")
        sys.exit(1)
    print(f"PASS: {message}")


def main() -> int:
    imap = IMAP.read_text(encoding="utf-8")
    oauth = OAUTH.read_text(encoding="utf-8")
    accounts = ACCOUNTS.read_text(encoding="utf-8")
    app_state = APP_STATE.read_text(encoding="utf-8")
    
    print("CASE_INSENSITIVE_ACCOUNT_DEDUPE_GUARD")
    require("COLLATE NOCASE" in imap, "gmail-imap-service.js uses COLLATE NOCASE")
    require("COLLATE NOCASE" in oauth, "gemini-oauth-service.js uses COLLATE NOCASE")
    require("seenEmails" in accounts, "AccountsView.swift tracks seen emails for deduplication")
    require("seenEmails" in app_state, "AppState.swift tracks seen emails for compose deduplication")
    
    print("SUCCESS: case-insensitive account deduplication guard passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
