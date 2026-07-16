#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
api = (root / "platform/cloud-mail/mail-worker/src/api/gemini-oauth-api.js").read_text()
backend = (root / "files/GlassMail-project/GlassMail/Services/Backend.swift").read_text()
views = (root / "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift").read_text()

def require(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")

for route in ["/v2/google/oauth/start", "/v2/gmail/oauth/start", "/v2/gmail/oauth/reconnect", "/v2/google/mail/oauth/start"]:
    require(route in api, f"Missing direct OAuth route alias {route}")
require("startGoogleMailboxOAuth(email: String, device: String, accountId: Int? = nil)" in backend, "iOS backend must support reconnect accountId")
require("Reconnect with Google OAuth" in views, "Existing Gmail reconnect must route to Google OAuth")
require("Connect Gmail with Google" in views, "Fresh Gmail add must route directly to Google OAuth")
print("PASS: gmail_direct_oauth_entry_guard")
