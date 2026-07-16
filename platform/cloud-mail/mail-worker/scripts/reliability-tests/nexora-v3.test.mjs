import { describe, expect, it } from 'vitest';
import nexoraV3Service, { AuthorityState, LifecycleState } from '../../src/service/nexora-v3-service.js';
import { AddMailboxStatus, UniversalMailboxActivationState, resolveEffectiveAuthority, resolveUniversalMailboxActivation } from '../../src/service/effective-authority-resolver.js';

describe('NEXORA V3 autonomy OS', () => {
	it('builds a complete provider matrix without claiming undeveloped adapters operational', () => {
		const matrix = nexoraV3Service.providerCapabilityMatrix();
		expect(matrix.map(row => row.provider)).toEqual(['cloudflare', 'google_workspace', 'microsoft_365', 'fastmail', 'zoho', 'proton', 'custom_imap_smtp', 'custom_domain']);
		expect(matrix.find(row => row.provider === 'microsoft_365').implementation_state).toBe('DECLARED_NOT_VALIDATED');
	});

	it('requests maximum relevant authority once and never silently escalates', () => {
		const result = nexoraV3Service.authorityMaximization({ provider: 'google', features: ['mail', 'calendar'], granted_scopes: ['openid'] });
		expect(result.authority_state).toBe(AuthorityState.PARTIALLY_AUTHORIZED);
		expect(result.requested_scopes).toContain('https://www.googleapis.com/auth/calendar');
		expect(result.missing_scopes).toContain('https://www.googleapis.com/auth/gmail.modify');
		expect(result.silent_escalation_allowed).toBe(false);
	});

	it('does not request unrelated provider scopes', () => {
		const result = nexoraV3Service.authorityMaximization({ provider: 'cloudflare', features: ['calendar'] });
		expect(result.requested_scopes).toEqual([]);
		expect(result.unsupported_capabilities).toContain('calendar_read_write');
	});

	it('requests scopes per selected capability instead of every provider scope', () => {
		const result = nexoraV3Service.authorityMaximization({ provider: 'google', features: ['calendar'] });
		expect(result.requested_scopes).toContain('https://www.googleapis.com/auth/calendar');
		expect(result.requested_scopes).not.toContain('https://www.googleapis.com/auth/gmail.modify');
		expect(result.requested_scopes).not.toContain('https://www.googleapis.com/auth/admin.directory.user');
	});

	it('never treats zero-scope custom credentials as verified authority', () => {
		const result = nexoraV3Service.authorityMaximization({ provider: 'custom_imap_smtp', features: ['mail'] });
		expect(result.authority_state).toBe('AUTHORIZATION_REQUIRED');
		expect(result.consent_required).toBe(true);
	});

	it('maps provider-specific capability vocabulary for custom domains and IMAP', () => {
		const domain = nexoraV3Service.authorityMaximization({ provider: 'custom_domain', features: ['domain_autonomy'] });
		const imap = nexoraV3Service.authorityMaximization({ provider: 'custom_imap_smtp', features: ['mail'] });
		expect(domain.supported_capabilities).toEqual(['dns_discovery', 'provider_detection']);
		expect(domain.authority_state).toBe('AUTHORIZATION_REQUIRED');
		expect(imap.supported_capabilities).toEqual(['mail_read', 'mail_send']);
	});

	it('ignores unrelated grants instead of reporting partial authority', () => {
		const result = nexoraV3Service.authorityMaximization({ provider: 'google', features: ['calendar'], granted_scopes: ['https://www.googleapis.com/auth/gmail.modify'] });
		expect(result.authority_state).toBe('AUTHORIZATION_REQUIRED');
		expect(result.granted_scopes).toEqual([]);
		expect(result.ignored_unrelated_scopes).toEqual(['https://www.googleapis.com/auth/gmail.modify']);
	});

	it('requires provider capability verification in addition to complete scopes', () => {
		const scopes = ['openid', 'email', 'https://www.googleapis.com/auth/gmail.modify', 'https://www.googleapis.com/auth/gmail.send'];
		const unverified = nexoraV3Service.authorityMaximization({ provider: 'google', features: ['mail'], granted_scopes: scopes });
		expect(unverified.authority_state).toBe(AuthorityState.AUTHORIZATION_REQUIRED);
		expect(unverified.missing_scopes).toEqual([]);
		expect(unverified.missing_capability_verification).toEqual(['mail_read_write', 'mail_send']);
		const verified = nexoraV3Service.authorityMaximization({ provider: 'google', features: ['mail'], granted_scopes: scopes, verified_capabilities: ['mail_read_write', 'mail_send'] });
		expect(verified.authority_state).toBe(AuthorityState.AUTHORIZED);
		expect(verified.capability_verification_required).toBe(false);
	});

	it('redacts secret-like graph evidence', () => {
		const graph = nexoraV3Service.authorityGraph({ provider: 'cloudflare', subject_ref: 'example.com', evidence: { zone_id: 'safe-ref', api_token: 'never-output', nested: { credential_secret: 'nested-never-output', result: 'safe' } } });
		expect(graph.evidence.zone_id).toBe('safe-ref');
		expect(JSON.stringify(graph)).not.toContain('never-output');
		expect(graph.evidence.nested.result).toBe('safe');
	});

	it('detects common custom-domain mailbox providers', () => {
		expect(nexoraV3Service.detectProvider({ domain: 'example.com', mx: ['aspmx.l.google.com'] })).toBe('google_workspace');
		expect(nexoraV3Service.detectProvider({ domain: 'example.com', mx: ['example-com.mail.protection.outlook.com'] })).toBe('microsoft_365');
	});

	it('keeps onboarding awaiting authority without falsely blocking a normal consent path', () => {
		const plan = nexoraV3Service.customDomainOnboarding({ email: 'ceo@example.com', provider: 'cloudflare', granted_scopes: [] });
		expect(plan.priority).toBe('CUSTOM_DOMAIN_FIRST');
		expect(plan.lifecycle_state).toBe(LifecycleState.NEEDS_ATTENTION);
		expect(plan.manual_dns_required).toBeNull();
		expect(plan.automation_blocked).toBe(false);
		expect(plan.automation_pending_authorization).toBe(true);
		expect(plan.add_mailbox_status).toBe(AddMailboxStatus.USER_CONSENT_REQUIRED);
		expect(plan.ready).toBe(false);
		expect(plan.mailbox_provider).toBe('custom_domain');
		expect(plan.infrastructure_provider).toBe('cloudflare');
		expect(plan.discovery_state).toBe('DISCOVERY_IN_PROGRESS');
	});

	it('keeps mailbox and infrastructure discovery independent for every custom domain', () => {
		const plan = nexoraV3Service.customDomainOnboarding({
			email: 'ceo@example.com',
			mx: ['aspmx.l.google.com'],
			infrastructure_provider: 'cloudflare'
		});
		expect(plan.mailbox_provider).toBe('google_workspace');
		expect(plan.infrastructure_provider).toBe('cloudflare');
		expect(plan.provider_graph.calendar_provider).toBe('google_workspace');
		expect(plan.provider_graph.dns_provider).toBe('cloudflare');
		expect(plan.discovery_state).toBe('DISCOVERY_COMPLETE');
		expect(plan.blockers.map(blocker => blocker.code)).toEqual(expect.arrayContaining(['MAILBOX_AUTHORIZATION_REQUIRED', 'INFRASTRUCTURE_AUTHORIZATION_REQUIRED']));
	});

	it('expresses independent provider adapter truth without inventing calendar or identity support', () => {
		const plan = nexoraV3Service.customDomainOnboarding({
			email: 'owner@example.com',
			mx: ['mail.example.net'],
			mailbox_provider: 'custom_imap_smtp',
			infrastructure_provider: 'cloudflare',
			features: ['mail', 'domain_autonomy']
		});
		expect(plan.selected_features).toEqual(['mail', 'domain_autonomy']);
		expect(plan.provider_graph.mailbox_provider).toBe('custom_imap_smtp');
		expect(plan.provider_graph.infrastructure_provider).toBe('cloudflare');
		expect(plan.provider_graph.adapters.mailbox.discovery_state).toBe('DISCOVERED');
		expect(plan.provider_graph.adapters.mailbox.implementation_state).toBe('DECLARED_NOT_VALIDATED');
		expect(plan.provider_graph.calendar_provider).toBeNull();
		expect(plan.provider_graph.adapters.calendar).toMatchObject({ discovery_state: 'PROVIDER_UNSUPPORTED', reason: 'MAILBOX_ADAPTER_HAS_NO_CALENDAR_CAPABILITY' });
		expect(plan.provider_graph.identity_provider).toBeNull();
	});

	it('marks declared Google calendar and identity paths as discovered but not operational by assertion alone', () => {
		const plan = nexoraV3Service.customDomainOnboarding({
			email: 'ceo@example.com',
			mx: ['aspmx.l.google.com'],
			infrastructure_provider: 'cloudflare',
			features: ['mail', 'calendar', 'organization']
		});
		expect(plan.provider_graph.calendar_provider).toBe('google_workspace');
		expect(plan.provider_graph.identity_provider).toBe('google_workspace');
		expect(plan.provider_graph.adapters.calendar).toMatchObject({ provider: 'google_workspace', implementation_state: 'PARTIAL', discovery_state: 'DISCOVERED' });
		expect(plan.authority_bundle.mailbox.authority_state).toBe(AuthorityState.AUTHORIZATION_REQUIRED);
		expect(plan.ready).toBe(false);
	});

	it('starts discovery for an email outside the authenticated profile without trusting client grants', async () => {
		const statements = [];
		const c = {
			get: key => key === 'user' ? { userId: 42, email: 'ceo@example.com' } : null,
			env: { db: { prepare: sql => ({ bind: (...bindings) => ({ first: async () => null, run: async () => { statements.push({ sql, bindings }); return { success: true }; } }) }) } }
		};
		const result = await nexoraV3Service.beginOnboarding(c, { email: 'admin@hengmao.org', provider: 'cloudflare', granted_scopes: ['anything'], verified_capabilities: ['mail_read', 'mail_send'] });
		expect(result.authority.authority_state).toBe('AUTHORIZATION_REQUIRED');
		expect(result.add_mailbox_status).toBe(AddMailboxStatus.USER_CONSENT_REQUIRED);
		expect(result.lifecycle_state).toBe('NEEDS_ATTENTION');
		expect(result.discovery_state).toBe('DISCOVERY_IN_PROGRESS');
		expect(result.mailbox_provider).toBe('custom_domain');
		expect(result.infrastructure_provider).toBe('cloudflare');
		expect(statements.some(row => row.sql.includes('nexora_domain_connections'))).toBe(false);
		expect(statements.some(row => row.sql.includes('nexora_add_mailbox_requests'))).toBe(true);
	});

	it('AUTH-001 reuses verified organization/domain authority for a new mailbox without blocking', () => {
		const result = resolveEffectiveAuthority({
			domain_verified: true,
			organization_grant: { authority_state: 'AUTHORIZED' }
		});
		expect(result.status).toBe(AddMailboxStatus.USER_CONSENT_REQUIRED);
		expect(result.domain_reused).toBe(true);
		expect(result.blocked).toBe(false);
	});

	it('AUTH-002 through AUTH-007 preserve distinct user-visible authority outcomes', () => {
		expect(resolveEffectiveAuthority({ domain_verified: true }).status).toBe(AddMailboxStatus.USER_CONSENT_REQUIRED);
		expect(resolveEffectiveAuthority({ mailbox_grant: { authority_state: 'AUTHORIZED' }, provider_capability: { optional_missing: ['archive'] } }).status).toBe(AddMailboxStatus.PARTIAL_AUTHORITY_AVAILABLE);
		expect(resolveEffectiveAuthority({ mailbox_exists: true }).status).toBe(AddMailboxStatus.MAILBOX_ALREADY_EXISTS);
		expect(resolveEffectiveAuthority({ provider_capability: { enterprise_required: ['directory'], enterprise_available: [] } }).status).toBe(AddMailboxStatus.PROVIDER_CAPABILITY_LIMITED);
		expect(resolveEffectiveAuthority({ policy_blocked: true }).status).toBe(AddMailboxStatus.POLICY_BLOCKED);
		expect(resolveEffectiveAuthority({ security_blocked: true }).status).toBe(AddMailboxStatus.SECURITY_BLOCKED);
	});

	it('UMAC-001 through UMAC-007 use one provider-neutral activation state for every independent concern', () => {
		expect(resolveUniversalMailboxActivation({ authority_status: AddMailboxStatus.READY_TO_ADD, ownership_state: 'VERIFIED', routing_state: 'READY' }).state).toBe(UniversalMailboxActivationState.READY);
		expect(resolveUniversalMailboxActivation({ authority_status: AddMailboxStatus.READY_TO_ADD, ownership_state: 'PENDING' }).state).toBe(UniversalMailboxActivationState.VERIFYING_OWNERSHIP);
		expect(resolveUniversalMailboxActivation({ authority_status: AddMailboxStatus.READY_TO_ADD, ownership_state: 'VERIFIED', routing_state: 'PENDING' }).state).toBe(UniversalMailboxActivationState.VERIFYING_ROUTING);
		expect(resolveUniversalMailboxActivation({ authority_status: AddMailboxStatus.PROVIDER_CAPABILITY_LIMITED }).state).toBe(UniversalMailboxActivationState.LIMITED_ACCESS);
		expect(resolveUniversalMailboxActivation({ authority_status: AddMailboxStatus.ADMIN_CONSENT_REQUIRED }).state).toBe(UniversalMailboxActivationState.AWAITING_ADMIN_APPROVAL);
		expect(resolveUniversalMailboxActivation({ authority_status: AddMailboxStatus.POLICY_BLOCKED }).state).toBe(UniversalMailboxActivationState.POLICY_BLOCKED);
		expect(resolveUniversalMailboxActivation({ authority_status: AddMailboxStatus.SECURITY_BLOCKED }).state).toBe(UniversalMailboxActivationState.SECURITY_BLOCKED);
	});

	it('renders a single human activation contract without leaking backend state codes', () => {
		const activation = resolveUniversalMailboxActivation({ authority_status: AddMailboxStatus.USER_CONSENT_REQUIRED });
		expect(activation).toMatchObject({ state: UniversalMailboxActivationState.AWAITING_USER_ACTION, label: 'Authorization required', primary_cta: 'Continue Setup' });
		expect(Object.keys(activation).sort()).toEqual(['label', 'primary_cta', 'progress', 'reason', 'recommended_action', 'state']);
		expect(JSON.stringify(activation)).not.toContain('AUTHORIZATION_REQUIRED');
	});

	it('isolates all workspace resources and memory', () => {
		const workspace = nexoraV3Service.identityWorkspace({ name: 'CEO Workspace', tenant_key: 'org-1' });
		expect(workspace.workspace_key).toBe('ceo_workspace');
		expect(workspace.isolated_resources).toContain('calendar');
		expect(workspace.isolated_resources).toContain('ai_context');
		expect(workspace.cross_workspace_memory).toBe(false);
	});

	it('enforces reversible alias lifecycle and terminal archive', () => {
		expect(nexoraV3Service.aliasTransition({ lifecycle_state: 'ACTIVE' }, 'disable').lifecycle_state).toBe('DISABLED');
		expect(nexoraV3Service.aliasTransition({ lifecycle_state: 'DISABLED' }, 'enable').lifecycle_state).toBe('ACTIVE');
		expect(() => nexoraV3Service.aliasTransition({ lifecycle_state: 'ARCHIVED' }, 'enable')).toThrow(/Archived/);
	});

	it('blocks remote trackers by default without claiming malware scanning', () => {
		const result = nexoraV3Service.privacyAnalysis({ html: '<img src="https://track.example/open?utm_source=x" width="1" height="1"><a href="http://xn--bad.example">open</a>' });
		expect(result.trackers_found).toBeGreaterThan(0);
		expect(result.trackers_blocked).toBe(result.trackers_found);
		expect(result.remote_content_default).toBe('BLOCKED');
		expect(result.malware_scanning_claimed).toBe(false);
	});

	it('keeps mail-derived calendar items suggested until a provider write is confirmed', () => {
		const result = nexoraV3Service.calendarIntelligence({ messages: [{ id: 1, subject: 'Contract renewal follow-up', snippet: 'We will review by deadline' }] });
		expect(result.items.map(item => item.item_type)).toEqual(expect.arrayContaining(['RENEWAL', 'FOLLOW_UP', 'COMMITMENT', 'REVIEW', 'DEADLINE']));
		expect(result.items.every(item => item.write_state === 'SUGGESTED')).toBe(true);
		expect(result.provider_write_performed).toBe(false);
	});

	it('creates source-bound meeting briefs', () => {
		const brief = nexoraV3Service.meetingBrief({ event: { title: 'Board review', participants: ['ceo@example.com'] }, messages: [{ participants: 'ceo@example.com', subject: 'Risk' }], risks: ['renewal'] });
		expect(brief.participant_context).toHaveLength(1);
		expect(brief.past_conversations).toHaveLength(1);
		expect(brief.source_bound).toBe(true);
	});

	it('builds tenant-isolated organization and identity graphs', () => {
		const org = nexoraV3Service.organizationGraph({ tenant_key: 't1', people: [{ id: 'p1', email: 'a@example.com' }], teams: [{ id: 'sales', name: 'Sales' }], memberships: [{ person: 'p1', team: 'sales' }] });
		const identity = nexoraV3Service.identityGraph({ tenant_key: 't1', identities: [{ email: 'alias@example.com', type: 'ALIAS' }] });
		expect(org.cross_tenant_traversal_allowed).toBe(false);
		expect(identity.display_name_merge_allowed).toBe(false);
		expect(identity.isolation_evidence).toBe('MODEL_ONLY_NOT_PERSISTED');
	});

	it('uses owner notification only after authorized, alternative, and fallback repair paths', () => {
		const plan = nexoraV3Service.repairPlan({ domain: 'example.com', drifts: [
			{ dimension: 'spf', state: 'DRIFT', authorized: true },
			{ dimension: 'dkim', state: 'DRIFT', alternative: true },
			{ dimension: 'dmarc', state: 'DRIFT', fallback: true },
			{ dimension: 'calendar', state: 'DRIFT' }
		] });
		expect(plan.actions.map(action => action.action)).toEqual(['AUTO_REPAIR', 'ALTERNATIVE_REPAIR', 'FALLBACK_REPAIR', 'OWNER_NOTIFICATION']);
		expect(plan.actions.every(action => action.destructive === false)).toBe(true);
	});

	it('recovers expired leases and closes unsupported work instead of leaving jobs running', async () => {
		const updates = [];
		const env = { db: { prepare: sql => ({ bind: (...bindings) => ({
			all: async () => ({ results: [{ id: 7, job_type: 'ONBOARD_DOMAIN' }] }),
			run: async () => { updates.push({ sql, bindings }); return { meta: { changes: 1 } }; }
		}) }) } };
		const result = await nexoraV3Service.monitorScheduled({ env }, { limit: 2 });
		expect(result).toMatchObject({ checked: 1, claimed: 1, blocked: 1 });
		expect(updates.some(row => row.sql.includes("state='BLOCKED'"))).toBe(true);
		expect(updates.some(row => row.sql.includes("state='SUCCEEDED'") && row.sql.includes('attempt_count=0'))).toBe(true);
		expect(updates.every(row => !row.sql.includes("state IN ('SUCCEEDED','FAILED'"))).toBe(true);
	});

	it('keeps Cloudflare environment verification admin-only', async () => {
		const c = { get: () => ({ userId: 4, email: 'user@example.com' }), env: { admin: 'owner@example.com', CLOUDFLARE_API_TOKEN: 'not-used' } };
		await expect(nexoraV3Service.verifyCloudflareDomain(c, 'example.com')).rejects.toThrow(/Administrator/);
	});

	it('aggregates truthful health and requires observed invariants for command-center readiness', () => {
		expect(nexoraV3Service.domainHealth({ dimensions: { dns: 'READY', mail: 'BLOCKED' } }).overall_state).toBe('BLOCKED');
		expect(nexoraV3Service.domainHealth({}).overall_state).toBe('NEEDS_ATTENTION');
		const healthyDimensions = { trust: 'READY', security: 'READY', dns: 'READY', mail: 'READY', identity: 'READY', calendar: 'READY', provisioning: 'READY', repair: 'READY' };
		const center = nexoraV3Service.executiveCommandCenter({ authority: 'AUTHORIZED', health: { dimensions: healthyDimensions }, readiness_invariants_observed: false });
		expect(center.health.overall_state).toBe('HEALTHY');
		expect(center.truthful_ready).toBe(false);
		expect(center.sections).toContain('PRIVACY');
		expect(nexoraV3Service.executiveCommandCenter({ authority: 'AUTHORIZATION_REQUIRED', health: { dimensions: healthyDimensions }, readiness_invariants_observed: true }).truthful_ready).toBe(false);
	});
});
