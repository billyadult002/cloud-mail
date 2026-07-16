#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
service = (root / "platform/cloud-mail/mail-worker/src/service/gemini-oauth-service.js").read_text()
api = (root / "platform/cloud-mail/mail-worker/src/api/gemini-oauth-api.js").read_text()
views = (root / "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift").read_text()

def require(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")

require("requestAccess(c" not in service, "Default OAuth start must not create approval request")
require("Gmail testing approval requested" not in api, "Callback must not show testing approval requested")
default_region = views[views.find("private var gmailMailboxSection"):views.find("@ViewBuilder\n    private var unsupportedProviderSection")]
require("Pending Approval" not in default_region, "Default Gmail add path must not show Pending Approval")
require("Request Access" not in default_region, "Default Gmail add path must not show Request Access")
print("PASS: gmail_no_legacy_approval_gate_guard")
