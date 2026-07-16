#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
views = (root / "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift").read_text()
request_service = (root / "platform/cloud-mail/mail-worker/src/service/google-test-user-request-service.js").read_text()

def require(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")

require("value == \"oauth_success\" || value.contains(\"google_synced\") { return .oauthSuccess }" in views, "oauth_success must not classify as pending")
require("WHEN google_oauth_test_user_requests.status IN ('oauth_success', 'google_synced') THEN google_oauth_test_user_requests.status" in request_service, "auto approval must not downgrade oauth_success")
print("PASS: gmail_no_oauth_success_under_pending_guard")
