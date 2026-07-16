#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
oauth_api = (root / "platform/cloud-mail/mail-worker/src/api/gemini-oauth-api.js").read_text()
service = (root / "platform/cloud-mail/mail-worker/src/service/google-test-user-request-service.js").read_text()
app_state = (root / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text()

def require(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")

require("pending_google_test_user" not in oauth_api, "OAuth callback must not return pending_google_test_user by default")
require("ELSE 'oauth_failed'" in service, "access_denied must record oauth_failed, not pending")
require("pendingApprovalCreated: false" in service, "access_denied result must state no pending approval was created")
require("Google OAuth blocked" in app_state, "iOS callback must show Google OAuth blocked truth")
require("This Gmail account is not yet approved" not in app_state, "iOS callback must not show legacy Pending Approval copy")
print("PASS: gmail_no_pending_approval_default_guard")
