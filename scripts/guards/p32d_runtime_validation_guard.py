#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "platform/cloud-mail/mail-worker"
SERVICE = WORKER / "src/service/p32d-runtime-validation-service.js"
P32C = WORKER / "src/service/p32c-enterprise-governance-service.js"
API = WORKER / "src/api/p32d-runtime-validation-api.js"
WEBS = WORKER / "src/hono/webs.js"
TEST = WORKER / "scripts/reliability-tests/p32d-runtime-validation.test.mjs"


def read(path: Path) -> str:
    if not path.exists():
        raise SystemExit(f"FAIL: missing {path}")
    return path.read_text(encoding="utf-8")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise SystemExit(f"FAIL: {message}")
    print(f"PASS: {message}")


def main() -> None:
    service = read(SERVICE)
    p32c = read(P32C)
    api = read(API)
    webs = read(WEBS)
    test = read(TEST)
    combined = service + p32c + api + test

    print("P32D_RUNTIME_VALIDATION_GUARD")
    require("p32d-runtime-validation-api" in webs, "P32D API is mounted")
    for endpoint in [
        "/v2/p32d/runtime/lifecycle/validate",
        "/v2/p32d/runtime/audit/hash-chain/validate",
        "/v2/p32d/runtime/message-event-spine/validate",
        "/v2/p32d/runtime/secure-link/validate",
        "/v2/p32d/runtime/inbound-security/validate",
        "/v2/p32d/runtime/domain-reconciler/validate",
        "/v2/p32d/runtime/rbac/validate",
        "/v2/p32d/runtime/mail-provider/validate",
        "/v2/p32d/runtime/internal-usability/contract",
        "/v2/p32d/runtime/validate-all",
    ]:
        require(endpoint in api, f"P32D endpoint exists: {endpoint}")

    for marker in [
        "validateLifecycleStateMachineRuntime",
        "purge_candidate_purges",
        "admin_delete_cannot_bypass_hold",
        "attachment_prune_cannot_bypass_hold",
        "destructive_actions_executed: false",
    ]:
        require(marker in service + test, f"lifecycle runtime validation marker preserved: {marker}")
    require("requestDisable" in p32c and "PURGE_ELIGIBLE ? MessageLifecycleState.PURGED" in p32c, "P32C lifecycle supports disable and eligible purge")

    for marker in [
        "validateAuditHashChain",
        "tampering_detected",
        "missing_event_detected",
        "content_logging_disabled",
        "same_transaction_or_outbox_pattern_required",
    ]:
        require(marker in service + test, f"audit hash chain validation marker preserved: {marker}")

    for event in [
        "received",
        "parsed",
        "quarantined",
        "provider_accepted",
        "bounced",
        "secure_link_revoked",
        "soft_deleted",
        "purged",
    ]:
        require(event in service + test, f"message event spine runtime event preserved: {event}")
    require("delivered_fabricated: false" in service and "provider_accepted_is_delivered: false" in service, "Delivered is not fabricated")

    for state in ["DRAFT", "ACTIVE", "EXPIRED", "REVOKED", "LEGAL_HOLD_LOCKED", "DISABLED", "FAILED"]:
        require(state in service + test, f"secure link runtime state preserved: {state}")
    require("external_smtp_recall_claimed: false" in service, "external SMTP recall is not claimed")

    for verdict in ["PASS", "WARN", "SUSPICIOUS", "QUARANTINE_RECOMMENDED", "BLOCKED", "UNKNOWN"]:
        require(verdict in service + test, f"inbound verdict validation preserves {verdict}")
    require("malware_scanning_claimed: false" in service and "mailbox_content_exposed: false" in service, "no malware/content overclaim")

    for case in ["dmarc_missing", "dmarc_invalid", "dmarc_valid_preserved", "mta_sts_missing", "tls_rpt_missing", "spf_conflict", "provider_return_path_missing"]:
        require(case in service + test, f"domain reconciler drift case preserved: {case}")
    require("destructive_overwrite_blocked: true" in service and "dns_ready_fabricated: false" in service, "DNS readiness is not fabricated")

    for marker in ["user_cannot_apply_legal_hold", "compliance_officer_can_request_legal_hold", "auditor_can_view_not_mutate", "destructive_purge_requires_future_review"]:
        require(marker in service + test, f"RBAC runtime validation marker preserved: {marker}")

    for provider in ["cloudflare_email_sending", "resend", "amazon_ses", "postmark", "cloudmail_relay"]:
        require(provider in service + test, f"mail provider runtime validation preserves {provider}")
    require("UNAUTHORIZED_CODE_2036_PRESERVED" in service + test and "send_pass_claimed: false" in service, "mail provider boundary preserved")
    require("synthetic_data_only" in service + test and "production_execution: 'NOT_AUTHORIZED'" in service, "synthetic-only runtime validation preserved")
    require("saercpku@gmail.com" not in combined, "forbidden signing/profile identity is not used")
    print("SUCCESS: P32D runtime validation guard passed.")


if __name__ == "__main__":
    main()
