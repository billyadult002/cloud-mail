// NEXORA Zero-Touch onboarding: provider discovery — deterministic signal evaluation plus a
// real-D1 evidence-persistence test.
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import providerDiscovery, { evaluateSignals, CONFIDENCE_THRESHOLD, domainOf } from '../../src/service/nexora-onboarding-provider-discovery-service.js';

describe('Provider discovery — deterministic signal evaluation', () => {
	it('a known Google consumer domain alone crosses the confidence threshold', () => {
		const result = evaluateSignals({ email: 'someone@gmail.com' });
		expect(result.provider).toBe('google');
		expect(result.sufficient).toBe(true);
		expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
	});

	it('a known Microsoft consumer domain alone crosses the confidence threshold', () => {
		const result = evaluateSignals({ email: 'someone@outlook.com' });
		expect(result.provider).toBe('microsoft');
		expect(result.sufficient).toBe(true);
	});

	it('V10: a custom enterprise domain with NO other signal does NOT silently pick a provider (low confidence, correctly insufficient)', () => {
		const result = evaluateSignals({ email: 'someone@some-custom-enterprise-domain.example' });
		expect(result.sufficient).toBe(false);
		expect(result.confidence).toBeLessThan(CONFIDENCE_THRESHOLD);
	});

	it('an existing prior connection is a strong signal even for an ambiguous custom domain', () => {
		const result = evaluateSignals({ email: 'someone@custom-domain.example', existingConnectionProvider: 'microsoft' });
		expect(result.provider).toBe('microsoft');
		expect(result.sufficient).toBe(true);
	});

	it('organization policy overrides an otherwise-ambiguous domain', () => {
		const result = evaluateSignals({ email: 'someone@custom-domain.example', organizationPolicyProvider: 'google' });
		expect(result.provider).toBe('google');
		expect(result.sufficient).toBe(true);
	});

	it('conflicting signals for the same domain reduce confidence rather than one silently winning', () => {
		// A capability probe alone contributes only a weak 0.6 signal; it should not, by itself,
		// beat the domain's complete absence of signal into a confident answer.
		const single = evaluateSignals({ email: 'x@custom.example', capabilityProbeResult: 'google' });
		expect(single.sufficient).toBe(false);
	});

	it('domainOf extracts the domain safely, including malformed input', () => {
		expect(domainOf('user@example.com')).toBe('example.com');
		expect(domainOf('not-an-email')).toBe('');
		expect(domainOf(null)).toBe('');
	});
});

describe('Provider discovery — real D1 evidence persistence', () => {
	const SCHEMA = `CREATE TABLE mission_runtime_events (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT, step_id TEXT, action_id TEXT,
		tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, event_type TEXT NOT NULL,
		from_state TEXT, to_state TEXT, expected_version INTEGER, fencing_token INTEGER,
		detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`;
	const c = { env };
	const scope = { tenantId: 990801, workspaceId: 990802 };

	beforeEach(async () => {
		await env.db.prepare(`DROP TABLE IF EXISTS mission_runtime_events`).run();
		await env.db.prepare(SCHEMA).run();
	});

	it('E18/V10: persists discovery inputs, confidence, and decision as evidence; insufficient confidence requests one minimal choice', async () => {
		const result = await providerDiscovery.discoverProvider(c, scope, { onboardingMissionId: 'ob-disc-1', email: 'someone@custom-enterprise.example' });
		expect(result.ok).toBe(false);
		expect(result.reason).toBe('PROVIDER_CHOICE_REQUIRED');
		expect(result.candidates).toEqual(['google', 'microsoft']); // minimal choice, no technical config exposed

		const row = await env.db.prepare(`SELECT detail_json FROM mission_runtime_events WHERE mission_id='ob-disc-1' AND event_type='PROVIDER_DISCOVERY_EVALUATED'`).first();
		const detail = JSON.parse(row.detail_json);
		expect(detail.domain).toBe('custom-enterprise.example');
		expect(typeof detail.confidence).toBe('number');
		expect(detail.sufficient).toBe(false);
	});

	it('a confident discovery returns the resolved provider and still persists evidence', async () => {
		const result = await providerDiscovery.discoverProvider(c, scope, { onboardingMissionId: 'ob-disc-2', email: 'someone@gmail.com' });
		expect(result.ok).toBe(true);
		expect(result.provider).toBe('google');
		const row = await env.db.prepare(`SELECT detail_json FROM mission_runtime_events WHERE mission_id='ob-disc-2'`).first();
		expect(JSON.parse(row.detail_json).provider).toBe('google');
	});
});
