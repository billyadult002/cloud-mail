#!/usr/bin/env python3
"""P27 regression guard for account-level timestamp display.

The Accounts surfaces must not show raw backend UTC/SQL timestamps. They should
reuse the same normalized, future-clamped relative display path as Mailbox
Health.
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
ACCOUNTS_VIEW = ROOT / "files/GlassMail-project/GlassMail/Views/AccountsView.swift"
CLOUDMAIL_V2 = ROOT / "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift"
MODELS = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        fail(f"missing required file: {path}")


def fail(message: str) -> None:
    print(f"P27_ACCOUNT_TIME_REGRESSION_FAIL: {message}")
    sys.exit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


app_state = read(APP_STATE)
accounts_view = read(ACCOUNTS_VIEW)
cloudmail_v2 = read(CLOUDMAIL_V2)
models = read(MODELS)

require(
    "func accountTimestampDisplayLabel(_ rawDate: String?) -> String" in app_state,
    "AppState must expose a shared account timestamp display helper",
)
helper = re.search(
    r"func accountTimestampDisplayLabel\(_ rawDate: String\?\) -> String \{(.*?)\n    \}",
    app_state,
    flags=re.S,
)
require(helper is not None, "could not locate account timestamp display helper body")
helper_body = helper.group(1)
require("providerSyncedDate(rawDate)" in helper_body, "account helper must parse through providerSyncedDate")
require("Just now" in helper_body and "s ago" in helper_body and "m ago" in helper_body, "account helper must use relative display")
require("Never synced" in helper_body, "account helper must retain a safe missing timestamp fallback")
require("EmailMessage.clampFutureDate(date)" in app_state, "provider timestamp parser must clamp future dates")
require('dateFormat = "yyyy-MM-dd HH:mm:ss"' in models + app_state, "SQL timestamp format must remain parseable")

require(
    "return lastSyncedAt" not in accounts_view,
    "AccountsView must not return raw lastSyncedAt strings",
)
require(
    "app.accountTimestampDisplayLabel(lastSyncedAt)" in accounts_view,
    "AccountsView must use shared account timestamp display helper",
)
require(
    "if let last = account.lastSyncedAt" not in cloudmail_v2
    and "if let last = mailbox.lastSyncedAt" not in cloudmail_v2,
    "CloudMailV2 account surfaces must not read raw last sync strings for display",
)
require(
    cloudmail_v2.count("app.accountTimestampDisplayLabel(") >= 3,
    "CloudMailV2 account surfaces must use shared timestamp helper",
)

print("P27_ACCOUNT_TIME_REGRESSION_PASS")
print("account_gmail_future_time=FIXED_BY_SHARED_DISPLAY_PATH")
print("account_timestamp_display=NORMALIZED_OR_CLAMPED")
print("account_time_consistency=GUARDED")
