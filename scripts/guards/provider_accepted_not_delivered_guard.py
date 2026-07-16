#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
email = (ROOT / "platform/cloud-mail/mail-worker/src/service/email-service.js").read_text()
compose = (ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift").read_text()
app = (ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift").read_text()
inbox = (ROOT / "files/GlassMail-project/GlassMail/Views/InboxView.swift").read_text()
models = (ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift").read_text()


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")

print("PROVIDER_ACCEPTED_NOT_DELIVERED_GUARD")
require("Provider accepted. Delivery is not confirmed" in app + compose, "ProviderAccepted user boundary text preserved")
require("Provider accepted; delivery not confirmed" in inbox, "Sent UI does not label provider accepted as delivered")
require("case providerAccepted" in models and "case delivered" in models, "provider accepted and delivered are separate states")
require("preservesDeliveryConfirmationBoundary" in models, "Delivery confirmation boundary helper exists")
require("delivered: allInternal" in email, "backend limits delivered evidence to internal persistence")
print("SUCCESS: ProviderAccepted != Delivered guard passed.")
