// NEXORA Cloudflare-managed domain provisioning: foundation layer — authority binding, domain
// discovery, mail-authority preflight, and deterministic change planning. Real D1 for
// persistence-backed pieces; deterministic for pure classification logic. No real Cloudflare
// API call is made anywhere in this pass (see docs/ADR-NEXORA-CLOUDFLARE-DOMAIN-PROVISIONING.md).
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import cloudflareAuthority from '../../src/service/nexora-cloudflare-authority-service.js';
import cloudflareDiscovery from '../../src/service/nexora-cloudflare-domain-discovery-service.js';
import cloudflarePreflight, { detectExistingProvider, nonDestructiveIntegrationOptions } from '../../src/service/nexora-cloudflare-mail-preflight-service.js';
import cloudflarePlanner, { classifyEmailRoutingDns, classifyCatchAll, overallClassification } from '../../src/service/nexora-cloudflare-change-planner-service.js';

const TENANT_ID = 991201;
const WORKSPACE_ID = 991202;

const SCHEMA = [
	`CREATE TABLE nexora_cloudflare_authorities (
		id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		cloudflare_account_id TEXT NOT NULL, zone_id TEXT, authorized_capabilities_json TEXT NOT NULL,
		permission_scope_json TEXT NOT NULL, credential_reference TEXT NOT NULL, authorization_source TEXT NOT NULL
		 CHECK(authorization_source IN ('scoped_api_token','oauth','organization_managed','deployment_secret')),
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT, revoked_at TEXT, revoked_reason TEXT,
		UNIQUE(onboarding_mission_id, cloudflare_account_id)
	)`,
	`CREATE TABLE nexora_cloudflare_domain_discoveries (
		id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		requested_domain TEXT NOT NULL, cloudflare_zone_id TEXT, nameserver_evidence_json TEXT NOT NULL DEFAULT '{}',
		dns_authoritative INTEGER NOT NULL DEFAULT 0, confidence REAL NOT NULL, sufficient INTEGER NOT NULL,
		signal_sources_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE nexora_cloudflare_mail_authority_observations (
		id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		zone_id TEXT NOT NULL, mx_records_json TEXT NOT NULL DEFAULT '[]', spf_state TEXT, dmarc_state TEXT,
		dkim_selectors_json TEXT NOT NULL DEFAULT '[]', existing_email_routing_enabled INTEGER NOT NULL DEFAULT 0,
		existing_routing_rules_json TEXT NOT NULL DEFAULT '[]', existing_workers_json TEXT NOT NULL DEFAULT '[]',
		existing_destination_addresses_json TEXT NOT NULL DEFAULT '[]', detected_existing_provider TEXT,
		catch_all_state TEXT, observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE nexora_cloudflare_change_plans (
		id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		zone_id TEXT NOT NULL, observation_id TEXT NOT NULL, plan_json TEXT NOT NULL,
		overall_classification TEXT NOT NULL CHECK(overall_classification IN ('no_change','safe_create','safe_update_owned','conflict','destructive_replacement','approval_required','unsupported','blocked')),
		approval_required INTEGER NOT NULL DEFAULT 0, approved_at TEXT, approved_by TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
];
const TABLES = ['nexora_cloudflare_authorities', 'nexora_cloudflare_domain_discoveries', 'nexora_cloudflare_mail_authority_observations', 'nexora_cloudflare_change_plans'];

async function resetSchema() {
	await env.db.batch(TABLES.map((t) => env.db.prepare(`DROP TABLE IF EXISTS ${t}`)));
	for (const sql of SCHEMA) await env.db.prepare(sql).run();
}

const c = { env };
const scope = { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID };

beforeEach(async () => {
	await resetSchema();
});

describe('Cloudflare authority binding — never stores a raw secret, always account+zone+capability scoped', () => {
	it('binds and checks a capability successfully', async () => {
		await cloudflareAuthority.bindAuthority(c, scope, { onboardingMissionId: 'cf-1', cloudflareAccountId: 'acct-1', zoneId: 'zone-1', authorizedCapabilities: ['InspectDnsRecords', 'EnableEmailRouting'], permissionScope: ['Zone:DNS:Edit'], credentialReference: 'cf_api_token_acct1', authorizationSource: 'scoped_api_token' });
		const check = await cloudflareAuthority.checkCapabilityAuthorized(c, scope, { onboardingMissionId: 'cf-1', cloudflareAccountId: 'acct-1', zoneId: 'zone-1', capability: 'EnableEmailRouting' });
		expect(check.authorized).toBe(true);
	});

	it('rejects binding a credential_reference that looks like a raw high-entropy secret', async () => {
		await expect(
			cloudflareAuthority.bindAuthority(c, scope, { onboardingMissionId: 'cf-2', cloudflareAccountId: 'acct-2', authorizedCapabilities: ['InspectDnsRecords'], permissionScope: [], credentialReference: 'aVeryLongBase64LookingStringThatResemblesARealCloudflareAPIToken1234567890==', authorizationSource: 'scoped_api_token' }),
		).rejects.toThrow('nexora_cloudflare_credential_reference_looks_like_raw_secret');
	});

	it('V1: denies an unauthorized capability precisely (CAPABILITY_NOT_AUTHORIZED, not a generic denial)', async () => {
		await cloudflareAuthority.bindAuthority(c, scope, { onboardingMissionId: 'cf-3', cloudflareAccountId: 'acct-3', authorizedCapabilities: ['InspectDnsRecords'], permissionScope: [], credentialReference: 'cf_ref_3', authorizationSource: 'scoped_api_token' });
		const check = await cloudflareAuthority.checkCapabilityAuthorized(c, scope, { onboardingMissionId: 'cf-3', cloudflareAccountId: 'acct-3', zoneId: null, capability: 'DeployEmailWorker' });
		expect(check.authorized).toBe(false);
		expect(check.reason).toBe('CAPABILITY_NOT_AUTHORIZED');
	});

	it('denies access to a zone outside the authorized account/zone scope', async () => {
		await cloudflareAuthority.bindAuthority(c, scope, { onboardingMissionId: 'cf-4', cloudflareAccountId: 'acct-4', zoneId: 'zone-authorized', authorizedCapabilities: ['EnableEmailRouting'], permissionScope: [], credentialReference: 'cf_ref_4', authorizationSource: 'scoped_api_token' });
		const check = await cloudflareAuthority.checkCapabilityAuthorized(c, scope, { onboardingMissionId: 'cf-4', cloudflareAccountId: 'acct-4', zoneId: 'zone-different', capability: 'EnableEmailRouting' });
		expect(check.authorized).toBe(false);
		expect(check.reason).toBe('ZONE_OUTSIDE_AUTHORIZED_ACCOUNT');
	});

	it('revocation makes every subsequent capability check fail with AUTHORIZATION_REVOKED', async () => {
		const bound = await cloudflareAuthority.bindAuthority(c, scope, { onboardingMissionId: 'cf-5', cloudflareAccountId: 'acct-5', authorizedCapabilities: ['InspectDnsRecords'], permissionScope: [], credentialReference: 'cf_ref_5', authorizationSource: 'scoped_api_token' });
		await cloudflareAuthority.revokeAuthority(c, scope, { authorityId: bound.id, reason: 'user_requested' });
		const check = await cloudflareAuthority.checkCapabilityAuthorized(c, scope, { onboardingMissionId: 'cf-5', cloudflareAccountId: 'acct-5', zoneId: null, capability: 'InspectDnsRecords' });
		expect(check.authorized).toBe(false);
		expect(check.reason).toBe('AUTHORIZATION_REVOKED');
	});

	it('missing authorization entirely is AUTHORIZATION_MISSING, not a crash', async () => {
		const check = await cloudflareAuthority.checkCapabilityAuthorized(c, scope, { onboardingMissionId: 'cf-none', cloudflareAccountId: 'acct-none', zoneId: null, capability: 'InspectDnsRecords' });
		expect(check.authorized).toBe(false);
		expect(check.reason).toBe('AUTHORIZATION_MISSING');
	});
});

describe('Cloudflare domain discovery — never implies write authority', () => {
	it('E12/V2: a matching zone with real Cloudflare nameservers is DNS-authoritative and sufficient', async () => {
		const result = await cloudflareDiscovery.discoverDomain(c, scope, { onboardingMissionId: 'cf-d1', requestedDomain: 'example.com', cloudflareZones: [{ id: 'zone-abc', name: 'example.com' }], observedNameservers: ['ns1.ns.cloudflare.com', 'ns2.ns.cloudflare.com'] });
		expect(result.dnsAuthoritative).toBe(true);
		expect(result.sufficient).toBe(true);
		expect(result.writeAuthorityImplied).toBe(false); // discovery alone never grants write authority
	});

	it('V2: a zone existing in the account WITHOUT the domain actually delegated to Cloudflare nameservers is NOT authoritative', async () => {
		const result = await cloudflareDiscovery.discoverDomain(c, scope, { onboardingMissionId: 'cf-d2', requestedDomain: 'example.com', cloudflareZones: [{ id: 'zone-abc', name: 'example.com' }], observedNameservers: ['ns1.someregistrar.com', 'ns2.someregistrar.com'] });
		expect(result.dnsAuthoritative).toBe(false);
		expect(result.sufficient).toBe(false);
	});

	it('no matching zone at all is correctly not sufficient', async () => {
		const result = await cloudflareDiscovery.discoverDomain(c, scope, { onboardingMissionId: 'cf-d3', requestedDomain: 'not-on-cloudflare.example', cloudflareZones: [{ id: 'zone-abc', name: 'example.com' }], observedNameservers: [] });
		expect(result.zoneId).toBeNull();
		expect(result.sufficient).toBe(false);
	});
});

describe('Mail-authority preflight and conflict detection — deterministic, no fabricated safety', () => {
	it('detects Google Workspace, Microsoft 365, and unknown providers from MX records', () => {
		expect(detectExistingProvider([{ value: 'aspmx.l.google.com' }])).toBe('google_workspace');
		expect(detectExistingProvider([{ value: 'contoso-com.mail.protection.outlook.com' }])).toBe('microsoft_365');
		expect(detectExistingProvider([{ value: 'mx.some-random-host.example' }])).toBe('unknown_provider');
		expect(detectExistingProvider([])).toBeNull();
	});

	it('E7/V4: an existing Google Workspace MX is flagged as a real conflict, never auto-classified safe', async () => {
		const result = await cloudflarePreflight.runPreflight(c, scope, { onboardingMissionId: 'cf-p1', zoneId: 'zone-1', mxRecords: [{ value: 'aspmx.l.google.com' }] });
		expect(result.hasConflict).toBe(true);
		expect(result.detectedProvider).toBe('google_workspace');
	});

	it('existing Cloudflare Email Routing MX is correctly treated as non-conflicting (already the target state)', async () => {
		const result = await cloudflarePreflight.runPreflight(c, scope, { onboardingMissionId: 'cf-p2', zoneId: 'zone-1', mxRecords: [{ value: 'route1.mx.cloudflare.net' }] });
		expect(result.hasConflict).toBe(false);
		expect(result.detectedProvider).toBe('cloudflare_email_routing');
	});

	it('no existing MX at all is safely non-conflicting', async () => {
		const result = await cloudflarePreflight.runPreflight(c, scope, { onboardingMissionId: 'cf-p3', zoneId: 'zone-1', mxRecords: [] });
		expect(result.hasConflict).toBe(false);
		expect(result.hasExistingMx).toBe(false);
	});

	it('Required Output #23: offers non-destructive integration strategies only when a conflict exists, none when there is none', () => {
		expect(nonDestructiveIntegrationOptions({ hasConflict: false })).toEqual([]);
		const options = nonDestructiveIntegrationOptions({ hasConflict: true });
		expect(options.length).toBeGreaterThan(0);
		expect(options.every((o) => o.destructive === false)).toBe(true);
	});
});

describe('Deterministic change planner — never rounds a plan up to safe when any item is not', () => {
	it('E22/V4: Email Routing DNS is classified conflict when an existing hard MX conflict is present, never safe_create', () => {
		const result = classifyEmailRoutingDns({ preflight: { hasConflict: true, detectedProvider: 'google_workspace', existingEmailRoutingEnabled: false, hasExistingMx: true }, requestEmailRouting: true });
		expect(result.classification).toBe('conflict');
	});

	it('Email Routing DNS is safe_create only when there is genuinely no existing mail authority', () => {
		const result = classifyEmailRoutingDns({ preflight: { hasConflict: false, hasExistingMx: false, existingEmailRoutingEnabled: false }, requestEmailRouting: true });
		expect(result.classification).toBe('safe_create');
	});

	it('Required Output #33: Catch-all is blocked unless tenant policy explicitly requests it, and approval_required even then', () => {
		expect(classifyCatchAll({ tenantPolicyExplicitlyRequestsCatchAll: false }).classification).toBe('blocked');
		expect(classifyCatchAll({ tenantPolicyExplicitlyRequestsCatchAll: true }).classification).toBe('approval_required');
	});

	it('overall plan classification is the most conservative item, not an average or the first item', () => {
		expect(overallClassification([{ classification: 'safe_create' }, { classification: 'conflict' }, { classification: 'no_change' }])).toBe('conflict');
		expect(overallClassification([{ classification: 'safe_create' }, { classification: 'safe_update_owned' }])).toBe('safe_update_owned');
		expect(overallClassification([])).toBe('no_change');
	});

	it('E16: a full plan is persisted with a real observation reference before any execution', async () => {
		const preflight = await cloudflarePreflight.runPreflight(c, scope, { onboardingMissionId: 'cf-plan-1', zoneId: 'zone-1', mxRecords: [] });
		const plan = await cloudflarePlanner.computeChangePlan(c, scope, { onboardingMissionId: 'cf-plan-1', zoneId: 'zone-1', observationId: preflight.observationId, preflight, desiredState: { emailRouting: true, catchAll: false } });
		expect(plan.overallClassification).toBe('safe_create');
		expect(plan.approvalRequired).toBe(false);
		const row = await env.db.prepare(`SELECT overall_classification,observation_id FROM nexora_cloudflare_change_plans WHERE id=?1`).bind(plan.planId).first();
		expect(row.overall_classification).toBe('safe_create');
		expect(row.observation_id).toBe(preflight.observationId);
	});

	it('a plan mixing a safe item and a conflicting item correctly reports the conservative overall classification', async () => {
		const preflight = await cloudflarePreflight.runPreflight(c, scope, { onboardingMissionId: 'cf-plan-2', zoneId: 'zone-1', mxRecords: [{ value: 'aspmx.l.google.com' }] });
		const plan = await cloudflarePlanner.computeChangePlan(c, scope, { onboardingMissionId: 'cf-plan-2', zoneId: 'zone-1', observationId: preflight.observationId, preflight, desiredState: { emailRouting: true, destinationAddresses: [{ email: 'a@x.com', alreadyVerified: false, alreadyRequested: false }] } });
		expect(plan.overallClassification).toBe('conflict'); // emailRouting item conflicts; destination item alone would be safe_create
	});
});
