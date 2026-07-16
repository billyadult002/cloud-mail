#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
api = (root / "platform/cloud-mail/mail-worker/src/api/gemini-oauth-api.js").read_text()
views = (root / "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift").read_text()
app_state = (root / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text()

def require(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")

for token in ["Google OAuth blocked", "cloudmailGovernance", "googleOAuthState", "mailboxState"]:
    require(token in api or token in app_state or token in views, f"Missing restriction truth token {token}")
for phrase in ["Testing Restricted", "Verification Required", "Workspace Admin Blocked", "Scope Not Approved", "User Cancelled", "Unknown Google OAuth Error"]:
    require(phrase in app_state or phrase in views, f"Missing Google restriction reason {phrase}")
require("Submit Access Request" not in views, "Restriction page must not default to Submit Access Request")
print("PASS: gmail_google_restriction_truth_guard")
