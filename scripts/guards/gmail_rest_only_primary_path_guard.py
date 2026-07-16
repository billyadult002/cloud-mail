#!/usr/bin/env python3
from pathlib import Path

root = Path(__file__).resolve().parents[2]
platform = (root / "platform/cloud-mail/mail-worker/src/service/gmail-platform-v2-service.js").read_text()
gmail_sync = (root / "platform/cloud-mail/mail-worker/src/service/gmail-imap-service.js").read_text()

def require(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")

require("REST_ONLY_ALLOWED_RUNTIME = 'gmail_rest_api'" in platform, "Gmail V2 primary runtime must be Gmail REST API")
require("LEGACY_IMAP_MODE = 'migration_only_reconnect_recovery_deprecated'" in platform, "Gmail IMAP must be migration/recovery only")
require("gmail.googleapis.com/gmail/v1/users/me/messages" in gmail_sync, "Gmail sync must use Gmail REST API messages endpoint")
print("PASS: gmail_rest_only_primary_path_guard")
