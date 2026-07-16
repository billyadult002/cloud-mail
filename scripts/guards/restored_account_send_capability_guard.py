#!/usr/bin/env python3
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
models = (ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift").read_text()
app = (ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text()
compose = (ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift").read_text()
settings = (ROOT / "files/GlassMail-project/GlassMail/Views/SettingsView.swift").read_text()
worker = (ROOT / "platform/cloud-mail/mail-worker/src/service/cloudmail-v2-service.js").read_text()
email_service = (ROOT / "platform/cloud-mail/mail-worker/src/service/email-service.js").read_text()

print("RESTORED_ACCOUNT_SEND_CAPABILITY_GUARD")
checks = {
    "owned Gmail send true only after mailbox ready": "sync_status = 'mailbox_ready'" in worker and '"mailbox_lifecycle_state":"MAILBOX_READY"' in worker and '"send":true' in worker,
    "Gmail fallback is not ready": "MAILBOX_READY_NOT_VERIFIED" in worker and '"mailbox_ready":false' in worker,
    "CloudMail native send true": "provider = 'cloudflare_native'" in worker and '"send":true' in worker,
    "delegated remains receive only": '"delegated":true' in worker and '"send":false' in worker,
    "send scope missing blocks send": "send_scope_missing" in worker + models,
    "iOS reads unified capability": "unified.canSend" in app and "restoredSendCapability(for:" in app,
    "sending identities carry reason": "sendStatusReason" in models + app + settings,
    "compose follows AppState capability": "app.canSend(from: address)" in compose,
    "backend still validates account owner": "accountRow.userId !== userId" in email_service,
    "ProviderAccepted boundary preserved": "ProviderAccepted != Delivered" not in worker and "delivered: allInternal" in email_service,
}
for label, ok in checks.items():
    if not ok:
        print(f"FAIL: {label}")
        sys.exit(1)
    print(f"PASS: {label}")
print("SUCCESS: Restored account send capability guard passed.")
