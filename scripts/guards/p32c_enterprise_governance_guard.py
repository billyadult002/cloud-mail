#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "platform/cloud-mail/mail-worker"
SERVICE = WORKER / "src/service/p32c-enterprise-governance-service.js"
ADAPTER = WORKER / "src/service/outbound-provider-adapter.js"
API = WORKER / "src/api/p32c-enterprise-governance-api.js"
WEBS = WORKER / "src/hono/webs.js"
MIGRATION = WORKER / "migrations/0024_p32c_enterprise_delivery_security_governance.sql"
TEST = WORKER / "scripts/reliability-tests/p32c-enterprise-governance.test.mjs"


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
    adapter = read(ADAPTER)
    api = read(API)
    webs = read(WEBS)
    migration = read(MIGRATION)
    test = read(TEST)
    combined = service + adapter + api + migration + test

    print("P32C_ENTERPRISE_GOVERNANCE_GUARD")
    require("p32c-enterprise-governance-api" in webs, "P32C API is mounted")
    for endpoint in [
        "/v2/p32c/domains/:domain/reconciler",
        "/v2/p32c/domains/:domain/mta-sts-tls-rpt",
        "/v2/p32c/inbound/security-assessment",
        "/v2/p32c/lifecycle/transition/dry-run",
        "/v2/p32c/lifecycle/contract",
        "/v2/p32c/audit/hash-event/dry-run",
        "/v2/p32c/org-rbac/seed",
        "/v2/p32c/message-event-spine/contract",
        "/v2/p32c/secure-links/lifecycle-contract",
        "/v2/p32c/adrs",
    ]:
        require(endpoint in api, f"P32C endpoint exists: {endpoint}")

    for marker in [
        "desiredEnterpriseDnsState",
        "enterpriseObservedDnsState",
        "reconcileDesiredWithObserved",
        "declarativeDomainReconciler",
        "drift_alert",
        "dns_change_proposed",
        "destructive: false",
    ]:
        require(marker in service, f"declarative domain reconciler marker preserved: {marker}")

    for marker in ["mta_sts_txt", "tls_rpt", "policy_file_readiness", "NOT_CLAIMED", "bimi_status"]:
        require(marker in service + test, f"MTA-STS/TLS-RPT foundation marker preserved: {marker}")

    for marker in [
        "spf_result",
        "dkim_result",
        "dmarc_result",
        "arc_result",
        "reply_to_mismatch",
        "display_name_spoof_flag",
        "QUARANTINE_RECOMMENDED",
        "malware_scanning_claimed: false",
    ]:
        require(marker in service + migration + test, f"inbound security assessment marker preserved: {marker}")

    for provider in ["cloudflare_email_sending", "resend", "amazon_ses", "postmark", "cloudmail_relay"]:
        require(provider in adapter + test, f"provider adapter preserved: {provider}")
    for marker in ["getReturnPathRecords", "handleBounce", "handleComplaint", "getSuppressionListStatus", "getDomainWarmupState", "getProviderHealthState"]:
        require(marker in adapter + test, f"provider hardening method preserved: {marker}")
    require("delivered: false" in adapter and "deliveryTruthState: 'provider_accepted'" in adapter, "ProviderAccepted remains separate from Delivered")

    for state in ["ACTIVE", "HELD", "RETAINED", "EXPIRED_PENDING", "SOFT_DELETED", "PURGE_ELIGIBLE", "PURGED", "REVOKED", "DISABLED"]:
        require(state in service + migration + test, f"message lifecycle state preserved: {state}")
    require("Legal Hold > Retention Minimum > Expiration > User Delete" in service, "lifecycle precedence preserved")

    for table in [
        "organizations",
        "tenants",
        "domain_ownership",
        "org_memberships",
        "roles",
        "permissions",
        "sensitive_action_reviews",
        "audit_hash_chain_events",
        "inbound_security_assessments",
        "message_lifecycle_state",
        "message_event_spine",
        "domain_reconciler_snapshots",
    ]:
        require(table in migration, f"P32C migration model present: {table}")

    for marker in ["prev_hash", "event_hash", "append_only: true", "tamper_evident: true", "content_logged: false"]:
        require(marker in service + migration + test, f"append-only audit hash chain marker preserved: {marker}")

    for role in ["OWNER", "ADMIN", "COMPLIANCE_OFFICER", "AUDITOR", "USER"]:
        require(role in service + migration + test, f"RBAC role preserved: {role}")
    require("destructive_purge" in service + test and "single_user_flow_preserved" in service, "sensitive review and single-user compatibility preserved")

    for event in ["provider_accepted", "delivered_if_proven", "secure_link_revoked", "soft_deleted", "purged"]:
        require(event in service + migration + test, f"message event spine event preserved: {event}")
    require("provider_accepted_is_delivered: false" in service and "delivered_requires_real_evidence: true" in service, "message event spine delivery truth preserved")

    require("cannot be physically recalled" in service + test and "FAILED" in service + test, "secure link lifecycle contract preserves external recall boundary")
    require("ADR-P32C-001" in service + test and "secure_vault" in service + test, "P32C ADRs preserved")
    require("hengmao.org" not in service + api + adapter, "P32C generic engine does not hardcode hengmao.org")
    require("saercpku@gmail.com" not in combined, "forbidden signing/profile identity is not used")
    print("SUCCESS: P32C enterprise governance guard passed.")


if __name__ == "__main__":
    main()
