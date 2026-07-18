-- NEXORA Cloudflare-managed domain provisioning: authority binding, discovery, and change-
-- plan persistence. Additive to 0037-0061. Cloudflare is a distinct infrastructure-authority
-- provider type from Google/Microsoft (account OAuth) -- see
-- docs/ADR-NEXORA-CLOUDFLARE-DOMAIN-PROVISIONING.md.
CREATE TABLE IF NOT EXISTS nexora_cloudflare_authorities (
 id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 cloudflare_account_id TEXT NOT NULL, zone_id TEXT, authorized_capabilities_json TEXT NOT NULL,
 permission_scope_json TEXT NOT NULL, credential_reference TEXT NOT NULL, authorization_source TEXT NOT NULL
  CHECK(authorization_source IN ('scoped_api_token','oauth','organization_managed','deployment_secret')),
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT, revoked_at TEXT, revoked_reason TEXT,
 UNIQUE(onboarding_mission_id, cloudflare_account_id)
);
-- Domain discovery is explicitly NOT write authority (Required Output #12) -- this table
-- records the discovery result only; nexora_cloudflare_authorities above is the only source
-- of write permission, and a row here never implies one there.
CREATE TABLE IF NOT EXISTS nexora_cloudflare_domain_discoveries (
 id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 requested_domain TEXT NOT NULL, cloudflare_zone_id TEXT, nameserver_evidence_json TEXT NOT NULL DEFAULT '{}',
 dns_authoritative INTEGER NOT NULL DEFAULT 0, confidence REAL NOT NULL, sufficient INTEGER NOT NULL,
 signal_sources_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Mail-authority preflight: the observed state of existing production mail configuration
-- before any plan is calculated. Desired/Observed/Verified separation (ADR-7).
CREATE TABLE IF NOT EXISTS nexora_cloudflare_mail_authority_observations (
 id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 zone_id TEXT NOT NULL, mx_records_json TEXT NOT NULL DEFAULT '[]', spf_state TEXT, dmarc_state TEXT,
 dkim_selectors_json TEXT NOT NULL DEFAULT '[]', existing_email_routing_enabled INTEGER NOT NULL DEFAULT 0,
 existing_routing_rules_json TEXT NOT NULL DEFAULT '[]', existing_workers_json TEXT NOT NULL DEFAULT '[]',
 existing_destination_addresses_json TEXT NOT NULL DEFAULT '[]', detected_existing_provider TEXT,
 catch_all_state TEXT, observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- The deterministic desired-state plan, persisted BEFORE execution (Required Output #16).
CREATE TABLE IF NOT EXISTS nexora_cloudflare_change_plans (
 id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 zone_id TEXT NOT NULL, observation_id TEXT NOT NULL, plan_json TEXT NOT NULL,
 overall_classification TEXT NOT NULL CHECK(overall_classification IN ('no_change','safe_create','safe_update_owned','conflict','destructive_replacement','approval_required','unsupported','blocked')),
 approval_required INTEGER NOT NULL DEFAULT 0, approved_at TEXT, approved_by TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Ownership metadata for every NEXORA-created Cloudflare resource (Required Output #18) --
-- the ONLY table that grants "this resource may be automatically repaired" (Required Output
-- #19/#40): a resource absent from this table is never touched by drift repair.
CREATE TABLE IF NOT EXISTS nexora_cloudflare_owned_resources (
 id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
 zone_id TEXT NOT NULL, resource_type TEXT NOT NULL CHECK(resource_type IN ('dns_record','routing_rule','email_worker','worker_binding','destination_address','catch_all')),
 cloudflare_resource_id TEXT NOT NULL, idempotency_key TEXT NOT NULL, desired_state_json TEXT NOT NULL,
 last_observed_state_json TEXT, last_verified_at TEXT, drift_detected_at TEXT, last_repair_at TEXT,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE(tenant_id, workspace_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_nexora_cf_authorities_scope ON nexora_cloudflare_authorities(tenant_id,workspace_id,cloudflare_account_id);
CREATE INDEX IF NOT EXISTS idx_nexora_cf_owned_resources_scope ON nexora_cloudflare_owned_resources(tenant_id,workspace_id,zone_id,resource_type);
