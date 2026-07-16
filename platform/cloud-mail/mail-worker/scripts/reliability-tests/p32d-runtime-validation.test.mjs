import { describe, expect, it } from 'vitest';
import p32dRuntimeValidationService from '../../src/service/p32d-runtime-validation-service.js';

describe('P32D enterprise security runtime validation', () => {
	it('validates lifecycle transitions and legal hold precedence with synthetic data', async () => {
		const result = await p32dRuntimeValidationService.validateLifecycleStateMachineRuntime();
		expect(result.status).toBe('PASS');
		expect(result.legal_hold_precedence).toBe('ENFORCED');
		expect(result.destructive_actions_executed).toBe(false);
		expect(result.results.map(row => row.name)).toContain('purge_candidate_purges');
		expect(result.results.every(row => row.status === 'PASS')).toBe(true);
	});

	it('validates append-only audit hash chain continuity and tamper detection', async () => {
		const result = await p32dRuntimeValidationService.validateAuditHashChain();
		expect(result.status).toBe('PASS');
		expect(result.continuity).toBe(true);
		expect(result.tampering_detected).toBe(true);
		expect(result.missing_event_detected).toBe(true);
		expect(result.content_logging_disabled).toBe(true);
		expect(result.chain[1].prev_hash).toBe(result.chain[0].event_hash);
	});

	it('validates message event spine without fabricated Delivered', () => {
		const result = p32dRuntimeValidationService.validateMessageEventSpine();
		expect(result.status).toBe('PASS');
		expect(result.provider_accepted_is_delivered).toBe(false);
		expect(result.delivered_fabricated).toBe(false);
		expect(result.events.map(event => event.event_type)).toContain('provider_accepted');
		expect(result.events.map(event => event.event_type)).not.toContain('delivered');
	});

	it('validates secure link lifecycle states and non-accessible terminal states', () => {
		const result = p32dRuntimeValidationService.validateSecureLinkLifecycle();
		expect(result.status).toBe('PASS');
		expect(result.states).toContain('LEGAL_HOLD_LOCKED');
		expect(result.states).toContain('FAILED');
		expect(result.revoked_or_expired_non_accessible).toBe(true);
		expect(result.external_smtp_recall_claimed).toBe(false);
	});

	it('validates inbound security verdict generation for all verdict states', () => {
		const result = p32dRuntimeValidationService.validateInboundSecurityVerdicts();
		expect(result.status).toBe('PASS');
		expect(result.malware_scanning_claimed).toBe(false);
		expect(result.mailbox_content_exposed).toBe(false);
		expect(result.results.map(row => row.name)).toEqual(['pass', 'warn', 'suspicious', 'quarantine', 'blocked', 'unknown']);
	});

	it('validates domain reconciler drift plans without DNS READY fabrication', async () => {
		const result = await p32dRuntimeValidationService.validateDomainReconcilerDrift();
		expect(result.status).toBe('PASS');
		expect(result.drift_detected).toBe(true);
		expect(result.destructive_overwrite_blocked).toBe(true);
		expect(result.dns_ready_fabricated).toBe(false);
	});

	it('validates org tenant RBAC policy checks and sensitive review path', () => {
		const result = p32dRuntimeValidationService.validateOrgTenantRbacPolicy();
		expect(result.status).toBe('PASS');
		expect(result.single_user_flow_preserved).toBe(true);
		expect(result.results.map(row => row.name)).toContain('destructive_purge_requires_future_review');
	});

	it('validates mail provider boundaries without send PASS claims', async () => {
		const result = await p32dRuntimeValidationService.validateMailProviderBoundary();
		expect(result.status).toBe('PASS');
		expect(result.cloudflare_email_sending_boundary).toBe('UNAUTHORIZED_CODE_2036_PRESERVED');
		expect(result.send_pass_claimed).toBe(false);
		expect(result.provider_secrets_printed).toBe(false);
		expect(result.results.map(row => row.name)).toEqual([
			'cloudflare_email_sending',
			'resend',
			'amazon_ses',
			'postmark',
			'cloudmail_relay'
		]);
	});

	it('validates internal usability API contract and full runtime aggregate', async () => {
		const contract = p32dRuntimeValidationService.validateInternalUsabilityApiContract();
		expect(contract.status).toBe('PASS');
		expect(contract.hash_chain_verify).toBe(true);
		expect(contract.event_spine_query).toBe(true);
		expect(contract.endpoints).toContain('POST /api/v2/p32d/runtime/validate-all');

		const aggregate = await p32dRuntimeValidationService.validateAll();
		expect(aggregate.status).toBe('PASS');
		expect(aggregate.synthetic_data_only).toBe(true);
		expect(aggregate.delivered_claimed).toBe(false);
	});
});
