#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
worker = (ROOT / "platform/cloud-mail/mail-worker/src/service/cloudmail-v2-service.js").read_text()
email = (ROOT / "platform/cloud-mail/mail-worker/src/service/email-service.js").read_text()

print("BACKEND_SEND_ELIGIBILITY_GUARD")
for marker in [
    "ownedAccountCapabilitiesSql",
    "send_scope_missing",
    "sync_status = 'mailbox_ready'",
    "provider = 'cloudflare_native'",
    "MAILBOX_READY_NOT_VERIFIED",
    "accountRow.userId !== userId",
    "roleService.hasAvailDomainPerm",
    "noSendProvider",
]:
    if marker not in worker + email:
        print(f"FAIL: missing backend send eligibility marker {marker}")
        sys.exit(1)
    print(f"PASS: {marker}")
print("SUCCESS: Backend send eligibility guard passed.")
