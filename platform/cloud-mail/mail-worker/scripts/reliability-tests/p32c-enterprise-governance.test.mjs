import { describe, expect, it } from 'vitest';
import p32cEnterpriseGovernanceService, {
	MessageEventType,
	MessageLifecycleState,
	SecurityVerdictState
} from '../../src/service/p32c-enterprise-governance-service.js';
import { outboundProviderAdapters } from '../../src/service/outbound-provider-adapter.js';

describe('P32C enterprise delivery security and governance foundation', () => {
	it('builds a declarative DNS reconciler with drift detection and non-destructive plans', async () => {
		const result = await p32cEnterpriseGovernanceService.declarativeDomainReconciler('example.net', {
			answers: {
				mx: [{ data: '60 route3.mx.cloudflare.net.' }],
				txt: [{ data: '"v=spf1 include:_spf.mx.cloudflare.net ~all"' }],
				dkim: [{ data: '"v=DKIM1; k=rsa; p=test"' }],
				dmarc: [],
				mtaStsTxt: [],
				tlsRpt: []
			}
		});

		expect(result.mode).toBe('dry-run');
		expect(result.destructive).toBe(false);
		expect(result.desired_dns_state.some(record => record.purpose === 'mta_sts_txt')).toBe(true);
		expect(result.desired_dns_state.some(record => record.purpose === 'tls_rpt')).toBe(true);
		expect(result.drift_detected).toBe(true);
		expect(result.plan.every(item => item.destructive === false)).toBe(true);
	});

	it('keeps MTA-STS and TLS-RPT in testing foundation without claiming enforce readiness', async () => {
		const state = await p32cEnterpriseGovernanceService.mtaStsTlsRptFoundation('example.net', {
			observed: {
				mta_sts_txt: ['v=STSv1; id=test'],
				tls_rpt: ['v=TLSRPTv1; rua=mailto:tlsrpt@example.net']
			}
		});

		expect(state.desired_policy_mode).toBe('testing');
		expect(state.mta_sts_txt_status).toBe('READY');
		expect(state.tls_rpt_status).toBe('READY');
		expect(state.enforce_readiness).toBe('NOT_CLAIMED');
		expect(state.bimi_status).toContain('NOT_BLOCKING');
	});

	it('assesses inbound security verdicts without logging content or claiming malware scanning', () => {
		const assessment = p32cEnterpriseGovernanceService.inboundSecurityAssessment({
			spf_result: 'pass',
			dkim_result: 'pass',
			dmarc_result: 'fail',
			reply_to_mismatch: true,
			phishing_score: 60
		});

		expect(Object.values(SecurityVerdictState)).toContain('QUARANTINE_RECOMMENDED');
		expect(assessment.security_verdict).toBe('SUSPICIOUS');
		expect(assessment.content_logged).toBe(false);
		expect(assessment.malware_scanning_claimed).toBe(false);
	});

	it('hardens provider abstraction with Postmark and delivery boundary foundations', async () => {
		const adapters = outboundProviderAdapters();
		expect(adapters.map(adapter => adapter.kind)).toEqual([
			'cloudflare_email_sending',
			'resend',
			'amazon_ses',
			'postmark',
			'cloudmail_relay'
		]);
		for (const adapter of adapters) {
			expect(await adapter.getReturnPathRecords('example.net')).toHaveLength(1);
			expect((await adapter.handleBounce()).delivered).toBe(false);
			expect((await adapter.handleComplaint()).delivered).toBe(false);
			expect((await adapter.getDomainWarmupState()).send_pass_claimed).toBe(false);
			expect(adapter.classifyProviderAcceptedWithoutDelivered({ id: 'provider-id' }).delivered).toBe(false);
		}
	});

	it('routes every deletion and purge request through one dry-run lifecycle state machine', () => {
		const contract = p32cEnterpriseGovernanceService.lifecycleStateMachine();
		expect(contract.states).toEqual(Object.values(MessageLifecycleState));
		expect(contract.required_apis).toContain('requestAttachmentPrune');
		const held = p32cEnterpriseGovernanceService.lifecycleTransition('ACTIVE', { action: 'requestPurge' }, { legal_hold: true });
		expect(held.to).toBe('HELD');
		expect(held.destructive).toBe(false);
		const retained = p32cEnterpriseGovernanceService.lifecycleTransition('ACTIVE', { action: 'requestDelete' }, { retention_minimum_active: true });
		expect(retained.to).toBe('RETAINED');
	});

	it('creates append-only tamper-evident audit hash events without content logging', async () => {
		const first = await p32cEnterpriseGovernanceService.appendOnlyAuditHashEvent({
			event_id: 'evt-1',
			action: 'dns_change_proposed',
			object_type: 'dns_record',
			object_id: '_dmarc.example.net',
			created_at: '2026-01-01T00:00:00Z'
		});
		const second = await p32cEnterpriseGovernanceService.appendOnlyAuditHashEvent({
			event_id: 'evt-2',
			action: 'legal_hold_apply',
			object_type: 'message',
			object_id: 'msg-1',
			prev_hash: first.event_hash,
			created_at: '2026-01-01T00:00:01Z'
		});

		expect(first.append_only).toBe(true);
		expect(second.prev_hash).toBe(first.event_hash);
		expect(second.event_hash).not.toBe(first.event_hash);
		expect(second.content_logged).toBe(false);
	});

	it('seeds organization, tenant, RBAC, sensitive action review, and event spine contracts', () => {
		const seed = p32cEnterpriseGovernanceService.orgTenantRbacSeed();
		expect(seed.roles).toEqual(['OWNER', 'ADMIN', 'COMPLIANCE_OFFICER', 'AUDITOR', 'USER']);
		expect(seed.sensitive_actions_requiring_future_two_person_review).toContain('destructive_purge');
		expect(seed.single_user_flow_preserved).toBe(true);

		const spine = p32cEnterpriseGovernanceService.messageEventSpineContract();
		expect(spine.events).toContain(MessageEventType.PROVIDER_ACCEPTED);
		expect(spine.events).toContain(MessageEventType.DELIVERED_IF_PROVEN);
		expect(spine.provider_accepted_is_delivered).toBe(false);
		expect(spine.delivered_requires_real_evidence).toBe(true);
	});

	it('hardens secure link lifecycle without external SMTP recall claims and records ADRs', () => {
		const contract = p32cEnterpriseGovernanceService.secureLinkLifecycleContract({ legal_hold: true });
		expect(contract.states).toContain('FAILED');
		expect(contract.status).toBe('LEGAL_HOLD_LOCKED');
		expect(contract.external_smtp_recall_claimed).toBe(false);
		expect(contract.product_truth).toContain('cannot be physically recalled');

		const adrs = p32cEnterpriseGovernanceService.architectureAdrs();
		expect(adrs.map(adr => adr.id)).toContain('ADR-P32C-001');
		expect(JSON.stringify(adrs)).toContain('secure_vault');
	});
});
