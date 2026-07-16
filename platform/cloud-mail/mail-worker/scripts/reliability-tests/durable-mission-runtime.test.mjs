import { describe, expect, it } from 'vitest';
import durableMissionRuntime, { STATES, allowed, assertTransition, hash, evaluateEvidence, evaluateVerifiedActionBoundary } from '../../src/service/durable-mission-runtime-service.js';

function approvalContext(changes) {
	const calls = [];
	return {
		calls,
		env: { db: { prepare: sql => ({ bind: (...bindings) => ({ run: async () => { calls.push({ sql, bindings }); return { meta: { changes } }; } }) }) } }
	};
}

function completionContext({ mission = {}, outcome = {} } = {}) {
	const safeMission = { id: 'mission-1', tenant_id: 1, workspace_id: 2, state: 'verification_pending', version: 3, claim_key: 'claim', ...mission };
	const safeRun = { id: 'run-1', tenant_id: 1, workspace_id: 2, state: 'running', fencing_token: 9, lease_until: '2099-01-01 00:00:00' };
	const safeOutcome = { id: 'outcome-1', tenant_id: 1, workspace_id: 2, mission_id: 'mission-1', state: 'verified', verification_state: 'verified', evidence_status: 'supported', evidence_claim_key: 'claim', evidence_expires_at: '2099-01-01 00:00:00', ...outcome };
	return {
		env: { db: { prepare: sql => ({ bind: () => ({
			first: async () => sql.includes('mission_runtime_missions') ? safeMission : sql.includes('mission_runtime_runs') ? safeRun : sql.includes('SELECT o.*') ? safeOutcome : null,
			run: async () => ({ meta: { changes: 1 } })
		}) }) } }
	};
}

	describe('Durable Mission Runtime P0 guards', () => {
	it('allows only explicit mission and step lifecycle transitions', () => {
		expect(allowed('mission', 'created', 'runnable')).toBe(true);
		expect(allowed('mission', 'running', 'completed')).toBe(false);
		expect(allowed('step', 'running', 'checkpointed')).toBe(true);
		expect(() => assertTransition('mission', 'completed', 'running')).toThrow('mission_runtime_transition_rejected');
	});
	describe('Evidence Ledger and Verified Action Boundary P0', () => {
		const policy = { required_evidence_json: JSON.stringify(['provider_observation']), freshness_seconds: 60, minimum_distinct_evidence: 1 };
		const evidence = (id, overrides = {}) => ({ id, evidence_type: 'provider_observation', status: 'supported', integrity_hash: `hash-${id}`, computed_integrity_hash: `hash-${id}`, observed_at: new Date().toISOString(), ...overrides });
		it('does not treat a tool-call result as sufficient evidence', () => {
			const result = evaluateEvidence({ policy, evidence: [] });
			expect(result.state).toBe('inconclusive');
			expect(result.reasonCodes).toContain('evidence_insufficient');
		});
		it('rejects stale, integrity-invalid, superseded, and duplicate evidence', () => {
			expect(evaluateEvidence({ policy, evidence: [evidence('stale', { observed_at: '2000-01-01T00:00:00.000Z' })] }).state).toBe('stale');
			expect(evaluateEvidence({ policy, evidence: [evidence('bad', { computed_integrity_hash: 'changed' })] }).state).toBe('not_verified');
			const old = evidence('old'); const replacement = evidence('new');
			const replaced = evaluateEvidence({ policy, evidence: [old, replacement], relations: [{ evidence_id: 'new', related_evidence_id: 'old', relation_type: 'supersedes' }] });
			expect(replaced.accepted.map(row => row.id)).toEqual(['new']);
			const duplicated = evaluateEvidence({ policy, evidence: [old, replacement], relations: [{ evidence_id: 'new', related_evidence_id: 'old', relation_type: 'duplicates' }] });
			expect(duplicated.accepted).toHaveLength(1);
		});
		it('reports contradictory evidence as conflicted rather than latest-wins', () => {
			const result = evaluateEvidence({ policy, evidence: [evidence('yes'), evidence('no')], relations: [{ evidence_id: 'yes', related_evidence_id: 'no', relation_type: 'contradicts' }] });
			expect(result.state).toBe('conflicted');
			expect(result.reasonCodes).toContain('evidence_conflict');
		});
		it('is deterministic for the same policy and evidence set', () => {
			const input = { policy, evidence: [evidence('one')] };
			expect(evaluateEvidence(input)).toEqual(evaluateEvidence(input));
		});
		it('holds outbound work at the exact approval boundary without a send permission', () => {
			const base = { identityValid: true, authorityValid: true, capabilityValid: true, approvalRequired: true, approvalValid: false, executionPersisted: false, observationPersisted: false, requiredClaimsVerified: false, scopeConsistent: true, expectedVersionValid: true, fencingValid: true };
			expect(evaluateVerifiedActionBoundary(base)).toEqual({ state: 'waiting_for_approval', reason: 'exact_approval_missing', sendPermitted: false });
			expect(evaluateVerifiedActionBoundary({ ...base, approvalValid: true, executionPersisted: true, observationPersisted: false, requiredClaimsVerified: false }).state).toBe('verification_pending');
			expect(evaluateVerifiedActionBoundary({ ...base, approvalRequired: false, approvalValid: false, executionPersisted: true, observationPersisted: true, requiredClaimsVerified: true }).state).toBe('verified');
		});
	});
	it('uses stable non-secret hashes for idempotency and evidence references', async () => {
		const first = await hash({ account_id: 44, operation: 'freshness_checkpoint_read_v1' });
		const second = await hash({ operation: 'freshness_checkpoint_read_v1', account_id: 44 });
		expect(first).toMatch(/^[a-f0-9]{64}$/);
		expect(first).not.toContain('44');
		expect(first).not.toEqual(await hash({ account_id: 45, operation: 'freshness_checkpoint_read_v1' }));
		expect(second).toMatch(/^[a-f0-9]{64}$/);
	});
	it('keeps execution bounded to the existing job transport and non-sending operations', () => {
		expect(typeof durableMissionRuntime.monitorScheduled).toBe('function');
		expect(Object.keys(STATES.mission)).not.toContain('completed');
	});
	it('consumes an approval once only when action, scope, parameters and authority context all match', async () => {
		const input = { approvalId: 'approval-1', actionId: 'action-1', paramsHash: 'params', authorityGeneration: 7, authorityContextHash: 'authority', approverId: 1 };
		await expect(durableMissionRuntime.consumeApproval(approvalContext(1), { tenantId: 1, workspaceId: 2 }, input)).resolves.toBe(true);
		await expect(durableMissionRuntime.consumeApproval(approvalContext(0), { tenantId: 1, workspaceId: 2 }, input)).rejects.toThrow('mission_runtime_approval_invalid');
		const context = approvalContext(1);
		await durableMissionRuntime.consumeApproval(context, { tenantId: 1, workspaceId: 2 }, input);
		expect(context.calls[0].sql).toContain('authority_context_hash');
		expect(context.calls[0].sql).toContain("state='approved'");
	});
	it('requires a current supported verified outcome before completing a mission', async () => {
		const input = { missionId: 'mission-1', runId: 'run-1', outcomeId: 'outcome-1', expectedVersion: 3, fencingToken: 9 };
		await expect(durableMissionRuntime.complete(completionContext(), { tenantId: 1, workspaceId: 2 }, input)).resolves.toBe(true);
		await expect(durableMissionRuntime.complete(completionContext({ outcome: { verification_state: 'stale' } }), { tenantId: 1, workspaceId: 2 }, input)).rejects.toThrow('mission_runtime_evidence_insufficient');
		await expect(durableMissionRuntime.complete(completionContext({ mission: { workspace_id: 3 } }), { tenantId: 1, workspaceId: 2 }, input)).rejects.toThrow('mission_runtime_scope_denied');
	});
});
