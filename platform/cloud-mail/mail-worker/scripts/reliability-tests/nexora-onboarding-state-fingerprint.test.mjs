import { describe, expect, it } from 'vitest';
import fingerprintService from '../../src/service/nexora-onboarding-state-fingerprint-service.js';

function fakeDb() {
	return {
		prepare(sql) {
			return {
				bind() { return this; },
				async all() {
					if (sql.includes('nexora_onboarding_tokens')) return { results: [{ onboarding_mission_id: 'm1', rotation_generation: 2, connection_health: 'healthy', provider_account_hash: 'hash' }] };
					if (sql.includes('nexora_onboarding_reauthorization_work')) return { results: [{ id: 'w1', status: 'AUTHORITY_RECEIVED', replacement_token_generation: 2 }] };
					if (sql.includes('nexora_onboarding_callback_checkpoints')) return { results: [{ correlation_id: 'c1', step: 'TOKEN_AUTHORITY_PERSISTED', status: 'PERSISTED' }] };
					if (sql.includes('nexora_onboarding_reauthorization_commit_results')) return { results: [{ id: 'r1', idempotency_key: 'k1', authority_tuple_hash: 'digest', status: 'EVIDENCE_PENDING' }] };
					if (sql.includes('nexora_onboarding_evidence_outbox')) return { results: [{ id: 'o1', commit_result_id: 'r1', status: 'PENDING', attempts: 0 }] };
					if (sql.includes('nexora_onboarding_state')) return { results: [{ mission_id: 'm1', phase: 'onboarding' }] };
					return { results: [{ id: 'c1', status: 'claimed', resume_checkpoint: 'resume:m1' }] };
				},
			};
		},
	};
}

describe('NEXORA redacted state fingerprint', () => {
	it('is deterministic and excludes sensitive values', async () => {
		const c = { env: { db: fakeDb() } };
		const first = await fingerprintService.fingerprintReplacementAuthorityState(c, { missionId: 'm1', tenantId: 1, workspaceId: 2 });
		const second = await fingerprintService.fingerprintReplacementAuthorityState(c, { missionId: 'm1', tenantId: 1, workspaceId: 2 });
		expect(first.digest).toBe(second.digest);
		const serialized = JSON.stringify(first.state);
		expect(serialized).not.toContain('access-token');
		expect(serialized).not.toContain('refresh-token');
		expect(serialized).not.toContain('authorization-code');
		expect(serialized).not.toContain('pkce-verifier');
	});
});
