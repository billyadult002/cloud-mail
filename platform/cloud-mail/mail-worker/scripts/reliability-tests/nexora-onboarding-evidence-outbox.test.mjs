import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import evidenceOutbox from '../../src/service/nexora-onboarding-evidence-outbox-service.js';
import missionRuntimeStatusService from '../../src/service/mission-runtime-status-service.js';

const scope = { tenantId: 771001, workspaceId: 771002 };
const schema = [
 `CREATE TABLE mission_runtime_evidence (id TEXT PRIMARY KEY,mission_id TEXT NOT NULL,run_id TEXT NOT NULL,step_id TEXT NOT NULL,action_id TEXT,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,claim_key TEXT NOT NULL,source_type TEXT NOT NULL,status TEXT NOT NULL,reference_hash TEXT NOT NULL,summary_json TEXT NOT NULL DEFAULT '{}',observed_at TEXT NOT NULL,expires_at TEXT,UNIQUE(tenant_id,workspace_id,reference_hash))`,
 `CREATE TABLE nexora_onboarding_evidence_outbox (id TEXT PRIMARY KEY,commit_result_id TEXT NOT NULL UNIQUE,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,event_type TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',attempts INTEGER NOT NULL DEFAULT 0,delivered_at TEXT,updated_at TEXT)`,
 `CREATE TABLE nexora_onboarding_evidence_delivery_leases (outbox_id TEXT PRIMARY KEY,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,owner TEXT,fencing_token INTEGER NOT NULL DEFAULT 0,lease_expires_at TEXT,attempt INTEGER NOT NULL DEFAULT 0,updated_at TEXT)`,
];

async function reset() {
	await env.db.batch([env.db.prepare('DROP TABLE IF EXISTS mission_runtime_evidence'), env.db.prepare('DROP TABLE IF EXISTS nexora_onboarding_evidence_outbox'), env.db.prepare('DROP TABLE IF EXISTS nexora_onboarding_evidence_delivery_leases')]);
	for (const statement of schema) await env.db.prepare(statement).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_evidence_outbox(id,commit_result_id,onboarding_mission_id,tenant_id,workspace_id,event_type,payload_json) VALUES('outbox-1','result-1','mission-1',?,?, 'REPLACEMENT_TOKEN_AUTHORITY_COMMITTED','{"provider":"google","token_generation":2,"provider_connection_generation":1}')`).bind(scope.tenantId, scope.workspaceId).run();
}

const c = { env };
beforeEach(reset);

describe('NEXORA canonical Evidence outbox delivery — real D1', () => {
	it('delivers exactly one canonical Evidence record and reuses it on duplicate retry', async () => {
		const first = await evidenceOutbox.deliverEvidenceOutbox(c, scope, { outboxId: 'outbox-1' });
		expect(first.delivered).toBe(true);
		expect(first.evidenceId).toBe('evidence:result-1');
		const duplicate = await evidenceOutbox.deliverEvidenceOutbox(c, scope, { outboxId: 'outbox-1' });
		expect(duplicate.delivered).toBe(false);
		const count = await env.db.prepare(`SELECT COUNT(*) AS count FROM mission_runtime_evidence WHERE tenant_id=?1 AND workspace_id=?2`).bind(scope.tenantId, scope.workspaceId).first();
		expect(count.count).toBe(1);
		const outbox = await env.db.prepare(`SELECT status,attempts FROM nexora_onboarding_evidence_outbox WHERE id='outbox-1'`).first();
		expect(outbox.status).toBe('DELIVERED');
		expect(outbox.attempts).toBe(1);
	});

	it('rejects wrong tenant without touching the authoritative outbox', async () => {
		const before = await env.db.prepare(`SELECT status,attempts FROM nexora_onboarding_evidence_outbox WHERE id='outbox-1'`).first();
		const result = await evidenceOutbox.deliverEvidenceOutbox(c, { tenantId: scope.tenantId + 1, workspaceId: scope.workspaceId }, { outboxId: 'outbox-1' });
		expect(result.delivered).toBe(false);
		const after = await env.db.prepare(`SELECT status,attempts FROM nexora_onboarding_evidence_outbox WHERE id='outbox-1'`).first();
		expect(after).toEqual(before);
	});

	it('rejects wrong callback lineage and provider/generation references before claiming', async () => {
		for (const request of [
			{ expectedMissionId: 'wrong-mission', reason: 'EVIDENCE_MISSION_LINEAGE_MISMATCH' },
			{ expectedProvider: 'microsoft', reason: 'EVIDENCE_PROVIDER_LINEAGE_MISMATCH' },
			{ expectedCommitResultId: 'wrong-result', reason: 'EVIDENCE_COMMIT_RESULT_LINEAGE_MISMATCH' },
			{ expectedTokenGeneration: 9, reason: 'EVIDENCE_TOKEN_GENERATION_MISMATCH' },
			{ expectedProviderConnectionGeneration: 9, reason: 'EVIDENCE_PROVIDER_CONNECTION_GENERATION_MISMATCH' },
		]) {
			await reset();
			const before = await env.db.prepare(`SELECT status,attempts FROM nexora_onboarding_evidence_outbox WHERE id='outbox-1'`).first();
			const result = await evidenceOutbox.deliverEvidenceOutbox(c, scope, { outboxId: 'outbox-1', ...request });
			expect(result.delivered).toBe(false);
			expect(result.reason).toBe(request.reason);
			expect(await env.db.prepare(`SELECT status,attempts FROM nexora_onboarding_evidence_outbox WHERE id='outbox-1'`).first()).toEqual(before);
		}
	});

	it('rejects session, correlation, replacement, and checkpoint lineage before claiming', async () => {
		await env.db.prepare(`UPDATE nexora_onboarding_evidence_outbox SET payload_json='{"provider":"google","token_generation":2,"provider_connection_generation":1,"authorization_session_id":"auth-1","callback_correlation_id":"corr-1","replacement_session_id":"repl-1","replacement_correlation_id":"repl-corr-1","checkpoint_lineage":"cp-1"}' WHERE id='outbox-1'`).run();
		for (const request of [
			{ expectedAuthorizationSessionId: 'wrong', reason: 'EVIDENCE_AUTHORIZATION_SESSION_LINEAGE_MISMATCH' },
			{ expectedCallbackCorrelationId: 'wrong', reason: 'EVIDENCE_CALLBACK_CORRELATION_LINEAGE_MISMATCH' },
			{ expectedReplacementSessionId: 'wrong', reason: 'EVIDENCE_REPLACEMENT_SESSION_LINEAGE_MISMATCH' },
			{ expectedReplacementCorrelationId: 'wrong', reason: 'EVIDENCE_REPLACEMENT_CORRELATION_LINEAGE_MISMATCH' },
			{ expectedCheckpointLineage: 'wrong', reason: 'EVIDENCE_CHECKPOINT_LINEAGE_MISMATCH' },
		]) {
			const before = await env.db.prepare(`SELECT status,attempts FROM nexora_onboarding_evidence_outbox WHERE id='outbox-1'`).first();
			const result = await evidenceOutbox.deliverEvidenceOutbox(c, scope, { outboxId: 'outbox-1', ...request });
			expect(result).toMatchObject({ delivered: false, reason: request.reason });
			expect(await env.db.prepare(`SELECT status,attempts FROM nexora_onboarding_evidence_outbox WHERE id='outbox-1'`).first()).toEqual(before);
		}
	});

	it('rejects wrong owner and takes over an expired lease with a higher fence', async () => {
		await env.db.prepare(`INSERT INTO nexora_onboarding_evidence_delivery_leases(outbox_id,tenant_id,workspace_id,owner,fencing_token,lease_expires_at) VALUES('outbox-1',?,?, 'owner-a',4,datetime('now','+5 minutes'))`).bind(scope.tenantId, scope.workspaceId).run();
		const before = await env.db.prepare(`SELECT status,attempts FROM nexora_onboarding_evidence_outbox WHERE id='outbox-1'`).first();
		const rejected = await evidenceOutbox.deliverEvidenceOutbox(c, scope, { outboxId: 'outbox-1', leaseOwner: 'owner-b' });
		expect(rejected.delivered).toBe(false);
		expect(await env.db.prepare(`SELECT status,attempts FROM nexora_onboarding_evidence_outbox WHERE id='outbox-1'`).first()).toEqual(before);
		await env.db.prepare(`UPDATE nexora_onboarding_evidence_delivery_leases SET lease_expires_at='2000-01-01 00:00:00' WHERE outbox_id='outbox-1'`).run();
		const takeover = await evidenceOutbox.deliverEvidenceOutbox(c, scope, { outboxId: 'outbox-1', leaseOwner: 'owner-b' });
		expect(takeover.delivered).toBe(true);
		const lease = await env.db.prepare(`SELECT owner,fencing_token FROM nexora_onboarding_evidence_delivery_leases WHERE outbox_id='outbox-1'`).first();
		expect(lease.owner).toBe('owner-b');
		expect(lease.fencing_token).toBe(5);
	});

	it('rejects a stale prior-owner fence without claiming or mutating delivery', async () => {
		await env.db.prepare(`INSERT INTO nexora_onboarding_evidence_delivery_leases(outbox_id,tenant_id,workspace_id,owner,fencing_token,lease_expires_at) VALUES('outbox-1',?,?, 'owner-b',2,datetime('now','+5 minutes'))`).bind(scope.tenantId, scope.workspaceId).run();
		const before = await env.db.prepare(`SELECT * FROM nexora_onboarding_evidence_outbox WHERE id='outbox-1'`).first();
		const result = await evidenceOutbox.deliverEvidenceOutbox(c, scope, { outboxId: 'outbox-1', leaseOwner: 'owner-a', expectedFencingToken: 1 });
		expect(result).toMatchObject({ delivered: false, reason: 'EVIDENCE_OUTBOX_STALE_FENCE' });
		expect(await env.db.prepare(`SELECT * FROM nexora_onboarding_evidence_outbox WHERE id='outbox-1'`).first()).toEqual(before);
		expect(await env.db.prepare(`SELECT owner,fencing_token FROM nexora_onboarding_evidence_delivery_leases WHERE outbox_id='outbox-1'`).first()).toMatchObject({ owner: 'owner-b', fencing_token: 2 });
	});

	it('keeps temporary Ledger failure retryable and delivers exactly once after recovery', async () => {
		await env.db.prepare(`DROP TABLE mission_runtime_evidence`).run();
		const failed = await evidenceOutbox.deliverEvidenceOutbox(c, scope, { outboxId: 'outbox-1' });
		expect(failed.delivered).toBe(false);
		expect(failed.reason).toBe('EVIDENCE_DELIVERY_RETRY_SCHEDULED');
		const pending = await env.db.prepare(`SELECT status,attempts FROM nexora_onboarding_evidence_outbox WHERE id='outbox-1'`).first();
		expect(pending.status).toBe('RETRY_SCHEDULED');
		await env.db.prepare(schema[0]).run();
		const retried = await evidenceOutbox.deliverEvidenceOutbox(c, scope, { outboxId: 'outbox-1' });
		expect(retried.delivered).toBe(true);
		expect((await env.db.prepare(`SELECT COUNT(*) AS count FROM mission_runtime_evidence`).first()).count).toBe(1);
	});

	it('exposes redacted delivery visibility without provider payload material', async () => {
		await evidenceOutbox.deliverEvidenceOutbox(c, scope, { outboxId: 'outbox-1' });
		const view = await missionRuntimeStatusService.evidenceDeliveryStatus(c, scope, { outboxId: 'outbox-1' });
		expect(view.deliveries).toHaveLength(1);
		expect(view.deliveries[0]).toMatchObject({ evidence_outbox_id: 'outbox-1', delivery_status: 'DELIVERED', canonical_evidence_reference: 'evidence:result-1', retry_eligibility: false });
		expect(view.deliveries[0]).not.toHaveProperty('payload_json');
		expect(view.deliveries[0]).not.toHaveProperty('authorization_code');
	});
});
