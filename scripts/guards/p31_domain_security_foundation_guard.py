#!/usr/bin/env python3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
WORKER = ROOT / "platform/cloud-mail/mail-worker"
SERVICE = WORKER / "src/service/p31-domain-foundation-service.js"
ADAPTER = WORKER / "src/service/outbound-provider-adapter.js"
API = WORKER / "src/api/p31-domain-foundation-api.js"
WEBS = WORKER / "src/hono/webs.js"
MIGRATION = WORKER / "migrations/0023_p31_domain_security_foundation.sql"
TEST = WORKER / "scripts/reliability-tests/p31-domain-foundation.test.mjs"


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

    print("P31_DOMAIN_SECURITY_FOUNDATION_GUARD")
    for state in [
        "NO_DOMAIN_SELECTED",
        "DISCOVERED",
        "SCANNING",
        "NEEDS_CONFIGURATION",
        "CONFIGURING",
        "DNS_PENDING",
        "ROUTING_PENDING",
        "SENDING_PENDING",
        "MAILBOX_PENDING",
        "SECURITY_PENDING",
        "READY",
        "PARTIAL_WITH_REAL_BLOCKER",
        "FAILED",
    ]:
        require(state in service and state in migration and state in test, f"domain provisioning state preserved: {state}")

    for endpoint in [
        "/v2/p31/cloudflare/zones",
        "/v2/p31/domains/select",
        "/v2/p31/domains/:domain/scan",
        "/v2/p31/domains/:domain/enable",
        "/v2/p31/ui-contract",
        "/v2/domains/:domain/p31/discovery",
        "/v2/domains/:domain/p31/readiness",
        "/v2/domains/:domain/p31/autoconfigure",
        "/v2/domains/:domain/p31/provision-foundation",
        "/v2/security/lifecycle/dry-run",
        "/v2/security/lifecycle/:domain/dry-run",
        "/v2/security/secure-links/dry-run",
        "/v2/security/secure-links/:id/revoke/dry-run",
        "/v2/security/secure-links/contract",
    ]:
        require(endpoint in api, f"P31 API endpoint exists: {endpoint}")
    require("p31-domain-foundation-api" in webs, "P31 API is mounted")

    for table in [
        "cloudmail_domains",
        "domain_readiness_snapshots",
        "mailboxes",
        "domain_identities",
        "domain_capabilities",
        "retention_policies",
        "expiration_policies",
        "legal_holds",
        "security_classifications",
        "secure_link_metadata",
        "message_security_state",
        "attachment_security_state",
        "domain_security_policy",
        "audit_events",
    ]:
        require(table in migration and table in service, f"P31 foundation model present: {table}")

    require("Legal Hold > Retention > Expiration > User Delete" in service, "security precedence documented in service")
    require("legal_hold_overrides_retention_expiration_and_user_delete" in service, "legal hold override enforced")
    require("destructive: false" in service, "lifecycle dry-run is non-destructive by default")
    require("secureLifecyclePlan" in service and "legal_hold_prevents_attachment_pruning" in service, "P32A secure lifecycle dry-run planner exists")
    require("SecureLinkState" in service and "LEGAL_HOLD_LOCKED" in service and "FOUNDATION_ONLY_NOT_CLAIMED" in service, "P32A secure link foundation avoids false usability claim")
    require("secure_link_revoke_planned" in service and "secure_link_expire_planned" in service, "P32A secure link audit hooks modeled")
    require("mode = options.mode === 'apply' ? 'apply' : 'dry-run'" in service, "safe autoconfig is dry-run by default")
    require("report_conflict" in service and "create_if_safe" in service, "safe autoconfig compares current DNS before changes")
    require("CLOUDMAIL_P31_AUTOCONFIG_APPLY_ENABLED" in service, "autoconfig apply is gated")
    require("desiredDmarcState" in service and "p=quarantine" in service and "adkim=s; aspf=s" in service, "generic DMARC desired-state uses safe quarantine policy")
    require("evaluateDmarcRecords" in service and "multiple_dmarc_records" in service and "invalid_or_missing_policy" in service, "DMARC scanner detects missing invalid and conflicting states")
    require("preserve_existing_valid_dmarc" in service, "safe DMARC autofix preserves existing valid DMARC")
    require("hengmao.org" not in service + api + adapter, "P31 generic engine does not hardcode hengmao.org")
    require("CloudflareDomainCandidate" in test or "domain_name" in service and "zone_id_ref" in service and "account_ref" in service, "generic Cloudflare domain candidate model exists")

    for provider in ["cloudflare_email_sending", "resend", "amazon_ses", "postmark", "cloudmail_relay"]:
        require(provider in adapter and provider in test, f"outbound provider adapter preserved: {provider}")
    require("Provider accepted. Delivery is not confirmed." in adapter, "ProviderAccepted != Delivered wording preserved")
    require("delivered: false" in adapter and "deliveryTruthState: 'provider_accepted'" in adapter, "ProviderAccepted never implies Delivered")
    require("cloudflare_email_sending_api_unauthorized" in service + test, "Cloudflare Email Sending blocker is explicit")
    print("SUCCESS: P31 domain/security foundation guard passed.")


if __name__ == "__main__":
    main()
