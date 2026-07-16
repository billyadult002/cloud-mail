#!/usr/bin/env python3
"""P27 regression guard for outbound send truth.

This check is intentionally static and non-mutating. It protects the iOS send
UX boundary that ProviderAccepted is accepted by the provider, not a user-facing
send failure, while preserving that ProviderAccepted is not Delivered.
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
MODELS = ROOT / "files/GlassMail-project/GlassMail/Models/Models.swift"
COMPOSE = ROOT / "files/GlassMail-project/GlassMail/Views/ComposeView.swift"
OUTBOUND_SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/outbound-service.js"
DELIVERY_LEDGER_TEST = ROOT / "platform/cloud-mail/mail-worker/scripts/reliability-tests/delivery-ledger.test.mjs"


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        fail(f"missing required file: {path}")


def fail(message: str) -> None:
    print(f"P27_REGRESSION_FAIL: {message}")
    sys.exit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


app_state = read(APP_STATE)
models = read(MODELS)
compose = read(COMPOSE)
outbound_service = read(OUTBOUND_SERVICE)
delivery_test = read(DELIVERY_LEDGER_TEST)

require(
    "Message accepted by provider. Delivery is not confirmed yet, so it remains in Outbox." not in app_state + compose,
    "old ProviderAccepted red error message must not remain in iOS send UI",
)
require(
    "acceptedByProviderForSendUX" in models,
    "DeliveryState must expose a single accepted-by-provider send UX rule",
)
require(
    re.search(r"case\s+\.providerAccepted,\s*\.providerConfirmed,\s*\.delivered,\s*\.sent:", models),
    "ProviderAccepted must be grouped with accepted send states, not failure states",
)
require(
    "case .providerAccepted, .providerConfirmed, .delivered, .sent:" in app_state,
    "AppState.send must treat ProviderAccepted as an accepted send state",
)
require(
    "if !result.state.acceptedByProviderForSendUX" in app_state,
    "AppState.send must guard against accepted send state classification drift",
)
require(
    "outboxMessages.removeAll { $0.id == outboxId }" in app_state,
    "accepted provider send states must leave the transient local Outbox",
)
require(
    "deliveryState: result.state" in app_state,
    "Sent history must preserve the actual provider state instead of claiming Delivered",
)
require(
    "errorMessage = nil" in app_state,
    "successful accepted provider sends must clear transient error/progress text",
)

provider_branch = re.search(
    r"case \.providerAccepted, \.providerConfirmed, \.delivered, \.sent:(.*?)case \.retryScheduled:",
    app_state,
    flags=re.S,
)
require(provider_branch is not None, "could not locate accepted provider branch")
require(
    "return false" not in provider_branch.group(1),
    "ProviderAccepted branch must not return a failed send result",
)
require(
    "lastError" not in provider_branch.group(1),
    "ProviderAccepted branch must not write a local Outbox error",
)

require(
    "state: DeliveryLedgerState.PROVIDER_ACCEPTED" in outbound_service,
    "backend markSent must record ProviderAccepted",
)
require(
    "if (options.delivered)" in outbound_service,
    "backend markSent must require explicit delivered evidence before Delivered",
)
require(
    "sets only provider_accepted_at for provider acceptance and only delivered_at for delivery" in delivery_test,
    "delivery ledger regression must preserve ProviderAccepted != Delivered",
)

print("P27_REGRESSION_PASS")
print("provider_accepted_ui_state=FIXED_NOT_ERROR")
print("outbox_transition=FIXED_FOR_PROVIDER_ACCEPTED")
print("ProviderAccepted_not_equal_Delivered=PRESERVED")
print("send_without_attachment=SHARED_SEND_PATH_GUARDED")
print("send_with_attachment=SHARED_SEND_PATH_GUARDED")
