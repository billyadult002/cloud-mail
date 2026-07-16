#!/usr/bin/env python3
"""Static contract gate for the GPT67 native secure-auth handoff.

This intentionally checks structure only; executable Worker tests and Xcode builds
remain the behavioral/compiler gates.
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
BACKEND = ROOT / "files/GlassMail-project/GlassMail/Services/Backend.swift"
VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift"
WORKER_AUTH_API = ROOT / "platform/cloud-mail/mail-worker/src/api/cloudmail-v2-api.js"
WORKER_LOGIN_API = ROOT / "platform/cloud-mail/mail-worker/src/api/login-api.js"

app_state = APP_STATE.read_text()
backend = BACKEND.read_text()
view = VIEW.read_text()
worker_auth_api = WORKER_AUTH_API.read_text()
worker_login_api = WORKER_LOGIN_API.read_text()

required_states = {
    "AUTH_NOT_REQUIRED",
    "AUTH_REQUIRED",
    "WAITING_FOR_USER_SECURE_INPUT",
    "AUTH_IN_PROGRESS",
    "AUTH_SUCCESS",
    "AUTH_FAILED",
    "AUTH_EXPIRED",
    "PROVISIONING_CONTINUED",
}

failures: list[str] = []
for state in sorted(required_states):
    if state not in app_state:
        failures.append(f"missing state {state}")

required_app_markers = [
    "authenticateSecurelyAndContinueProvisioning",
    "cancelSecureAuthHandoff",
    "resumeSecureAuthHandoff",
    "expireSecureAuthIfNeeded",
    "postMailboxReadyNotification",
]
for marker in required_app_markers:
    if marker not in app_state:
        failures.append(f"missing AppState transition/action {marker}")

required_backend_markers = [
    "/auth/provisioning-handoff",
    "/auth/provisioning-continuation",
    "/auth/bootstrap-from-routing",
    "challengeReference",
    "deviceReference",
]
for marker in required_backend_markers:
    if marker not in backend:
        failures.append(f"missing Backend contract marker {marker}")

required_view_markers = [
    'SecureField("Enter password securely on iPhone"',
    '.privacySensitive()',
    'accessibilityIdentifier("Secure authentication input")',
    'accessibilityIdentifier("Secure authentication email")',
    'accessibilityIdentifier("Resume secure authentication")',
]
for marker in required_view_markers:
    if marker not in view:
        failures.append(f"missing secure UI marker {marker}")

if worker_auth_api.count("private, no-store") < 3:
    failures.append("auth challenge/continuation/bootstrap responses are not all marked no-store")
if "private, no-store" not in worker_login_api:
    failures.append("login response is not marked no-store")

# The handoff-specific code must not persist or log its input. Limit the scan to
# the implementation region to avoid unrelated legacy account features.
start = app_state.find("func authenticateSecurelyAndContinueProvisioning")
end = app_state.find("private static func secureDeviceReference", start)
handoff_region = app_state[start:end]
for forbidden in ["UserDefaults", "AppStorage", "Keychain", "print(", "NSLog", "os_log", "Logger("]:
    if forbidden in handoff_region:
        failures.append(f"handoff region contains forbidden persistence/logging API {forbidden}")

if re.search(r"(errorMessage|secureAuthOutcomeMessage)\s*=.*\b(secret|password)\b", handoff_region, re.I):
    failures.append("handoff status/error text may include a raw secret variable")

if failures:
    print("SECURE_AUTH_CONTRACT: FAIL")
    for failure in failures:
        print(f"- {failure}")
    sys.exit(1)

print("SECURE_AUTH_CONTRACT: PASS")
print(f"states={len(required_states)} ui_markers={len(required_view_markers)} backend_markers={len(required_backend_markers)}")
