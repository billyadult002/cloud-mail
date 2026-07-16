#!/usr/bin/env python3
"""P27 regression guard for Google testing OAuth eligibility visibility."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
SETTINGS = ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift"
SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/google-test-user-request-service.js"


def fail(message: str) -> None:
    print(f"P27_OAUTH_ELIGIBILITY_REGRESSION_FAIL: {message}")
    sys.exit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


settings = SETTINGS.read_text(encoding="utf-8")
service = SERVICE.read_text(encoding="utf-8")

for token in [
    "Tester:",
    "Google Sync:",
    "OAuth Eligible:",
    "testerStatusLabel",
    "googleSyncStatusLabel",
    "oauthEligibilityLabel",
    "oauthEligibilityReason",
]:
    require(token in settings, f"missing OAuth eligibility UI token: {token}")

require(
    '"approved_waiting_google_sync": return "NO"' in settings,
    "approved-but-not-Google-synced testers must not be shown as OAuth eligible",
)
require(
    '"google_synced", "oauth_success": return "YES"' in settings,
    "Google-synced or OAuth-success testers must be shown as OAuth eligible",
)
require(
    "approved in CloudMail, but not confirmed in the Google OAuth tester set" in settings,
    "CloudMail approval vs Google tester sync reason must be user-visible",
)
require(
    "APPROVED_WAITING_GOOGLE_SYNC" in service and "GOOGLE_SYNCED" in service and "OAUTH_SUCCESS" in service,
    "backend test-user lifecycle states must remain distinct",
)
require(
    "recordAccessDenied" in service and "pending_google_test_user" in service,
    "access_denied must continue to be recorded as a testing request instead of fabricated success",
)

print("P27_OAUTH_ELIGIBILITY_REGRESSION_PASS")
print("google_account_testing=CLOSURE_IMPLEMENTED")
print("oauth_eligibility_visible=TRUE")
print("cloudmail_approval_not_equal_google_oauth_eligibility=PRESERVED")
