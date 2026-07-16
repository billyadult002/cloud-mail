#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
views = (root / "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift").read_text()

def require(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")

for phrase in ["Auto Approved Gmail", "Google OAuth Blocked", "OAuth Success", "Enterprise Pending"]:
    require(phrase in views, f"Approval Center missing section {phrase}")
require("expandedPending = false" in views, "Enterprise Pending must default collapsed")
require("value == \"oauth_failed\" { return .googleOAuthBlocked }" in views, "oauth_failed must classify as Google OAuth Blocked")
require("value == \"oauth_success\"" in views and "return .oauthSuccess" in views, "oauth_success must classify as OAuth Success")
print("PASS: gmail_approval_center_rescope_guard")
