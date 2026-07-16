#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
service = (root / "platform/cloud-mail/mail-worker/src/service/gemini-oauth-service.js").read_text()
request_service = (root / "platform/cloud-mail/mail-worker/src/service/google-test-user-request-service.js").read_text()
ios = (root / "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift").read_text()

def require(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")

require("recordAutoApproved" in service, "Gmail OAuth start must record CloudMail auto approval")
require("requestAccess(c" not in service, "Default Gmail OAuth start must not call requestAccess")
require("cloudmailGovernance: 'auto_approved'" in service, "OAuth start must expose auto-approved governance truth")
require("CloudMail Governance: Auto Approved" in ios, "iOS Gmail path must show auto-approved governance truth")
require("Request Access" not in ios[ ios.find("private var gmailMailboxSection"): ios.find("@ViewBuilder\n    private var unsupportedProviderSection") ], "Default Gmail add section must not show Request Access")
require("AUTO_APPROVED_NOTE" in request_service, "Worker must persist auto-approved evidence without a migration")
print("PASS: gmail_auto_approve_default_guard")
