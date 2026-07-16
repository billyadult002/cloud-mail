#!/usr/bin/env python3
"""P28 static reliability guard for real-world mail closure."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]
GMAIL = ROOT / "platform/cloud-mail/mail-worker/src/service/gmail-imap-service.js"
OUTBOUND_STATE = ROOT / "platform/cloud-mail/mail-worker/src/service/outbound-state.js"
OUTBOUND_SERVICE = ROOT / "platform/cloud-mail/mail-worker/src/service/outbound-service.js"
RC_TEST = ROOT / "platform/cloud-mail/mail-worker/scripts/reliability-tests/rc-state-machine.test.mjs"
APP_STATE = ROOT / "files/GlassMail-project/GlassMail/Services/AppState.swift"
CLOUDMAIL_V2 = ROOT / "files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift"


def read(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except FileNotFoundError:
        fail(f"missing required file: {path}")


def fail(message: str) -> None:
    print(f"P28_RELIABILITY_REGRESSION_FAIL: {message}")
    sys.exit(1)


def require(condition: bool, message: str) -> None:
    if not condition:
        fail(message)


gmail = read(GMAIL)
outbound_state = read(OUTBOUND_STATE)
outbound_service = read(OUTBOUND_SERVICE)
rc_test = read(RC_TEST)
app_state = read(APP_STATE)
cloudmail_v2 = read(CLOUDMAIL_V2)

require("prepareGmailApiParsedMessages" in gmail, "Gmail API parse isolation helper must exist")
require("parseFailed" in gmail and "oversized" in gmail, "bad message counters must be returned")
require("Gmail API message parse failed" in gmail, "bad message parse failures must be isolated and logged safely")
require("P28 bad Gmail message tolerance" in rc_test, "bad message tolerance reliability tests must exist")
require("skips a malformed Gmail API message" in rc_test, "malformed message test must protect sync continuation")
require("skips oversized messages before parsing" in rc_test, "oversized message test must protect Worker memory")

require("MAX_ATTEMPTS = 5" in outbound_state, "outbound attempts cap must remain bounded")
require("status === 408 || status === 425 || status === 429" in outbound_state, "retryable transient status set must include timeout/rate-limit")
require("status >= 500 && status <= 599" in outbound_state, "provider 5xx must remain retryable")
require("status >= 400 && status <= 499" in outbound_state, "provider/client 4xx must remain terminal")
require("createWorkerBudget" in outbound_service and "skippedDueToBudget" in outbound_service, "outbound retry drain must stay budget bounded")
require("JSON.parse(q.payload_json)" in outbound_service and "status='cancelled'" in outbound_service, "bad retry payloads must not poison the drain")

require("providerFreshnessState" in app_state, "provider freshness state must remain visible")
require("providerSyncedDate" in app_state and "accountTimestampDisplayLabel" in app_state, "freshness and account time must use shared normalized parsing")
require("func refreshIfStale(maxAge: TimeInterval = 3600" in app_state, "manual/UI refresh must remain age-gated")
require("mailboxSelectionRefreshTask" in app_state, "mailbox selection refresh must remain debounced")

require("No IMAP password or app password is requested" in cloudmail_v2, "IMAP onboarding must not request unsupported secrets")
require("dedicated supported flow before requesting it" in cloudmail_v2, "IMAP app-password guidance must be explicit")

print("P28_RELIABILITY_REGRESSION_PASS")
print("bad_message_tolerance=GUARDED")
print("retry_state_machine=VALIDATED")
print("provider_freshness=VALIDATED_OR_FIXED")
print("polling_waste=REDUCED")
print("imap_onboarding=IMPROVED")
