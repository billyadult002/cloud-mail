#!/usr/bin/env python3
"""Guard Provider Truth Engine, receive reality, and mailbox capability closure."""
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[2]


def require(condition: bool, message: str) -> None:
    if not condition:
        print(f"FAIL: {message}")
        sys.exit(1)
    print(f"PASS: {message}")


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def main() -> int:
    models = read("files/GlassMail-project/GlassMail/Models/Models.swift")
    app_state = read("files/GlassMail-project/GlassMail/Services/AppState.swift")
    backend = read("files/GlassMail-project/GlassMail/Services/Backend.swift")
    diagnostics = read("files/GlassMail-project/GlassMail/Views/CloudMailV2Views.swift")
    settings = read("files/GlassMail-project/GlassMail/Views/SettingsView.swift")
    worker_service = read("platform/cloud-mail/mail-worker/src/service/google-test-user-request-service.js")
    worker_api = read("platform/cloud-mail/mail-worker/src/api/google-test-user-request-api.js")
    gmail_service = read("platform/cloud-mail/mail-worker/src/service/gmail-imap-service.js")
    gmail_api = read("platform/cloud-mail/mail-worker/src/api/gmail-api.js")

    print("PROVIDER_TRUTH_RECEIVE_REALITY_GUARD")

    for marker in [
        "ProviderTruthGovernanceStatus",
        "ProviderTruthAuthorizationStatus",
        "ProviderTruthCapabilityStatus",
        "ProviderTruthRecoveryStatus",
        "ProviderTruthSyncStatus",
        "ProviderTruthFreshnessStatus",
        "ProviderTruthSnapshot",
        "MailboxMetricsTruthSnapshot",
    ]:
        require(marker in models, f"model exists: {marker}")

    for marker in [
        "providerTruthSnapshot(for account:",
        "providerTruthSnapshot(for unified:",
        "googleProviderEvidenceVerified",
        "Enrollment Not Verified",
        "syncTruthStatus",
        "freshnessTruthStatus",
        "receiveBlockedReason",
        "Capability refresh required",
        "syncProviderMailboxesInBackground",
        "backend.syncGmail(accountId:",
        "mailboxMetricsTruthSnapshot",
    ]:
        require(marker in app_state, f"AppState truth marker: {marker}")

    require("return .testerPending" in app_state and "localOAuthAccessRequests.contains" in app_state, "Local CloudMail approval is not promoted to Approved Tester")
    require("submitGoogleOAuthAccessRequestToBackend" in app_state, "Request Access submits backend approval queue")
    require("/v2/google-test-user-requests/request" in backend, "iOS Backend has user Request Access endpoint")
    require("async requestAccess(c" in worker_service, "Worker has user requestAccess service")
    require("app.post('/v2/google-test-user-requests/request'" in worker_api, "Worker exposes non-admin Request Access endpoint")

    for marker in [
        "Diagnostics V6",
        "Governance Status",
        "Provider Status",
        "Capability Status",
        "Mailbox Status",
        "Sync Status",
        "Freshness",
        "Last Provider Sync",
        "Last Successful Import",
        "Newest Provider Message",
        "Newest Imported Message",
        "Failure Reason",
        "Recovery Path",
        "Recovery Guidance",
        "Truth Source",
        "Enrollment Not Verified",
    ]:
        require(marker in diagnostics, f"Diagnostics V6 marker: {marker}")

    for marker in [
        "Provider reachability, sync, freshness, ledger, and inbox visibility verified",
        "No provider messages visible in Global Message Ledger yet",
        "Provider sync requested",
        "Provider sync completed",
    ]:
        require(marker in app_state, f"Receive reality marker: {marker}")

    for marker in [
        "Receive Reality V2: never mix backfill into a forward receive fetch",
        "ids.length === 0 && minUid > 1",
        "Stale running sync was requeued before completion",
        "accountTimeoutMs",
        "receiveRealityProbe",
        "latestGmailLedgerEvidence",
    ]:
        require(marker in gmail_service, f"Gmail receive reality marker: {marker}")
    require("app.post('/gmail/receive-reality/probe'" in gmail_api, "Worker exposes authenticated Gmail receive reality probe")

    for marker in [
        "local draft ledger",
        "local sent ledger",
        "local outbox ledger",
        "Global Message Ledger",
        "unified ledger view",
    ]:
        require(marker in settings, f"Settings truth source marker: {marker}")

    print("provider_truth_receive_reality_guard: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
