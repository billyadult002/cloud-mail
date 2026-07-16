import { describe, expect, it } from 'vitest';
import p31DomainFoundationService, { DomainProvisioningState, SecureLinkState } from '../../src/service/p31-domain-foundation-service.js';
import { outboundProviderAdapters } from '../../src/service/outbound-provider-adapter.js';

describe('P31 domain and security foundation', () => {
	it('preserves legal hold precedence over expiration and deletion', () => {
		const result = p31DomainFoundationService.lifecycleDryRun({
			legal_hold: true,
			expires_at: 1,
			now: 10
		});

		expect(result.action).toBe('preserve');
		expect(result.destructive).toBe(false);
		expect(result.reason).toContain('legal_hold_overrides');
	});

	it('keeps lifecycle execution non-destructive by default after expiration', () => {
		const result = p31DomainFoundationService.lifecycleDryRun({
			expires_at: 1,
			now: 10
		});

		expect(result.action).toBe('eligible_for_expiration_queue');
		expect(result.destructive).toBe(false);
	});

	it('builds a P32A secure lifecycle plan with enforced precedence and audit hooks', () => {
		const plan = p31DomainFoundationService.secureLifecyclePlan('example.net', {
			legal_hold: true,
			retention_until: 20,
			expires_at: 1,
			now: 10,
			user_delete_requested: true
		});

		expect(plan.mode).toBe('dry-run');
		expect(plan.destructive).toBe(false);
		expect(plan.precedence).toBe('Legal Hold > Retention > Expiration > User Delete');
		expect(plan.message_security_state.action).toBe('preserve');
		expect(plan.attachment_security_state.reason).toBe('legal_hold_prevents_attachment_pruning');
		expect(plan.audit_events).toContain('legal_hold_override_applied');
	});

	it('models secure link statuses, revoke metadata, and dry-run contract without claiming secure-send usability', () => {
		expect(Object.values(SecureLinkState)).toEqual([
			'DRAFT',
			'ACTIVE',
			'EXPIRED',
			'REVOKED',
			'LEGAL_HOLD_LOCKED',
			'DISABLED'
		]);
		const revoked = p31DomainFoundationService.secureLinkMetadataFoundation('example.net', {
			revoked_at: '2026-01-01T00:00:00Z',
			view_limit: 3,
			attachment_download_policy: 'metadata_only'
		});
		expect(revoked.status).toBe('REVOKED');
		expect(revoked.destructive).toBe(false);
		expect(revoked.view_limit).toBe(3);
		expect(revoked.audit_events).toContain('secure_link_revoke_planned');
		const contract = p31DomainFoundationService.secureLinkApiContract('example.net');
		expect(contract.statuses).toContain('LEGAL_HOLD_LOCKED');
		expect(contract.secure_send_usability).toBe('FOUNDATION_ONLY_NOT_CLAIMED');
	});

	it('models the required P31 provisioning states', () => {
		expect(Object.values(DomainProvisioningState)).toEqual([
			'NO_DOMAIN_SELECTED',
			'DISCOVERED',
			'SCANNING',
			'NEEDS_CONFIGURATION',
			'CONFIGURING',
			'DNS_PENDING',
			'ROUTING_PENDING',
			'SENDING_PENDING',
			'MAILBOX_PENDING',
			'SECURITY_PENDING',
			'READY',
			'PARTIAL_WITH_REAL_BLOCKER',
			'FAILED'
		]);
	});

	it('supports a generic no-domain-selected and selected-domain instance model', () => {
		expect(p31DomainFoundationService.selectDomain(null).state).toBe('NO_DOMAIN_SELECTED');
		const selected = p31DomainFoundationService.selectDomain('Example.COM', [{
			domain_name: 'example.com',
			zone_id_ref: 'zone-ref',
			account_ref: 'account-ref',
			eligible_for_cloudmail: true,
			risk_flags: []
		}]);
		expect(selected.domain_name).toBe('example.com');
		expect(selected.state).toBe('DISCOVERED');
		expect(selected.supports_multiple_domains).toBe(true);
		expect(selected.zone_id_ref).toBe('zone-ref');
	});

	it('does not collapse provider accepted into delivered in outbound adapters', () => {
		const adapters = outboundProviderAdapters();
		expect(adapters.map(adapter => adapter.kind)).toEqual([
			'cloudflare_email_sending',
			'resend',
			'amazon_ses',
			'postmark',
			'cloudmail_relay'
		]);
		for (const adapter of adapters) {
			const classification = adapter.classifyProviderAcceptedWithoutDelivered({ id: 'provider-id' });
			expect(classification.providerAccepted).toBe(true);
			expect(classification.delivered).toBe(false);
			expect(classification.deliveryTruthState).toBe('provider_accepted');
		}
	});

	it('creates a conservative readiness result when DMARC and outbound are blocked', () => {
		const discovery = {
			dns: {
				ns: { status: 'READY' },
				mx: { status: 'READY' },
				spf: { status: 'READY' },
				dkim: { status: 'READY' },
				dmarc: { status: 'MISSING' }
			},
			cloudflare: {
				emailRouting: { status: 'ready', enabled: true }
			},
			outboundProvider: {
				status: 'blocked',
				reason: 'cloudflare_email_sending_api_unauthorized'
			}
		};

		const readiness = p31DomainFoundationService.readinessFrom(discovery);
		expect(readiness.real_domain_state).toBe('PARTIAL_WITH_REAL_BLOCKER');
		expect(readiness.dmarc_status).toBe('MISSING');
		expect(readiness.outbound_provider_status).toContain('CLOUDFLARE_EMAIL_SENDING_API_UNAUTHORIZED');
	});

	it('builds desired DNS state for arbitrary domains without hardcoding a validation domain', () => {
		const records = p31DomainFoundationService.desiredDnsState('example.net');
		expect(records.map(record => record.name)).toContain('example.net');
		expect(records.map(record => record.name)).toContain('_dmarc.example.net');
		expect(records.find(record => record.purpose === 'dmarc_policy').content).toContain('p=quarantine');
		expect(JSON.stringify(records)).not.toContain('hengmao.org');
	});

	it('evaluates DMARC missing, invalid, conflicting, and valid states precisely', () => {
		expect(p31DomainFoundationService.evaluateDmarcRecords([]).status).toBe('MISSING');
		expect(p31DomainFoundationService.evaluateDmarcRecords(['v=SPF1 include:example']).status).toBe('INVALID');
		expect(p31DomainFoundationService.evaluateDmarcRecords([
			'v=DMARC1; p=none',
			'v=DMARC1; p=quarantine'
		]).status).toBe('CONFLICTING');
		const valid = p31DomainFoundationService.evaluateDmarcRecords(['v=DMARC1; p=reject; adkim=s; aspf=s']);
		expect(valid.status).toBe('READY');
		expect(valid.rua_status).toBe('absent_not_blocking');
	});

	it('keeps safe autoconfig non-destructive and dry-run friendly', () => {
		const plan = p31DomainFoundationService.compareDesiredDnsState(
			p31DomainFoundationService.desiredDnsState('example.net'),
			[]
		);
		expect(plan.every(row => row.destructive === false)).toBe(true);
		expect(plan.some(row => row.action === 'create_if_safe')).toBe(true);
	});

	it('preserves an existing valid DMARC instead of overwriting it', () => {
		const plan = p31DomainFoundationService.compareDesiredDnsState([
			p31DomainFoundationService.desiredDmarcState('example.net')
		], [
			{ type: 'TXT', name: '_dmarc.example.net', content: 'v=DMARC1; p=none' }
		]);
		expect(plan[0].status).toBe('READY');
		expect(plan[0].action).toBe('preserve_existing_valid_dmarc');
		expect(plan[0].destructive).toBe(false);
	});

	it('detects DNS conflicts instead of overwriting records', () => {
		const plan = p31DomainFoundationService.compareDesiredDnsState([
			{ type: 'TXT', name: 'example.net', content: 'v=spf1 include:_spf.mx.cloudflare.net ~all', purpose: 'spf' }
		], [
			{ type: 'TXT', name: 'example.net', content: 'v=spf1 include:other.example ~all' }
		]);
		expect(plan[0].status).toBe('CONFLICTING');
		expect(plan[0].action).toBe('report_conflict');
	});

	it('exposes a stable zero-touch UI/API contract', () => {
		const contract = p31DomainFoundationService.uiApiContract();
		expect(contract.endpoints).toContain('GET /api/v2/p31/cloudflare/zones');
		expect(contract.endpoints).toContain('POST /api/v2/p31/domains/:domain/enable');
		expect(contract.states).toContain('Partial with blocker');
	});

	it('models generic inbound, mailbox, security, and lifecycle foundations', () => {
		expect(p31DomainFoundationService.inboundFoundation('example.net').architecture).toContain('Bad message isolation');
		expect(p31DomainFoundationService.mailboxIdentityCapabilityFoundation('example.net').capability_matrix.send).toBe('pending_outbound_provider');
		expect(p31DomainFoundationService.securityFoundation('example.net').rule_precedence).toContain('Legal Hold');
		expect(p31DomainFoundationService.lifecycleDryRunFoundation('example.net').domain_revalidation_dry_run.destructive).toBe(false);
		expect(p31DomainFoundationService.lifecycleDryRunFoundation('example.net').secure_lifecycle_plan.secure_link.destructive).toBe(false);
	});
});
