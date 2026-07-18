// NEXORA EXISTING KERNEL GAP-VERIFIED COMPLETION — Checkpoint 4 real-persistence verification.
//
// The existing durable-mission-runtime.test.mjs only exercises pure functions (allowed/
// assertTransition/evaluateEvidence/evaluateVerifiedActionBoundary) and hand-rolled fake D1
// stubs that return canned rows. That proves the guard logic and SQL shape, but NOT real
// persistence behavior: lease expiry, restart recovery, duplicate-submission rejection,
// duplicate-checkpoint rejection, or DB-enforced evidence append-only triggers.
//
// This file runs the REAL exported functions from durable-mission-runtime-service.js against
// a pool-workers ephemeral local D1, using the inlined schema copied verbatim from migrations
// 0037-0040 (durable_mission_runtime_kernel / execution_hardening / evidence_ledger_verified_
// action_boundary / provider_capability_authorization_contract). It does not modify
// durable-mission-runtime-service.js or any other file the parallel NEXORA effort owns.

import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import durableMissionRuntime, { allowed, hash } from '../../src/service/durable-mission-runtime-service.js';
import missionRuntimeStatusService from '../../src/service/mission-runtime-status-service.js';

const TENANT_ID = 990201;
const WORKSPACE_ID = 990202;

// Verbatim from migrations/0037-0040 (structure only; ALTER TABLE columns folded into the
// base CREATE TABLE since pool-workers starts from an empty DB each test, not a migration
// replay). Every column/constraint/trigger below traces to those four migration files.
const SCHEMA_STATEMENTS = [
	`CREATE TABLE mission_runtime_missions (
		id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
		kind TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, idempotency_key TEXT NOT NULL,
		claim_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		completed_at TEXT, UNIQUE(tenant_id,workspace_id,idempotency_key)
	)`,
	`CREATE TABLE mission_runtime_runs (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		state TEXT NOT NULL, fencing_token INTEGER NOT NULL DEFAULT 0, lease_until TEXT, version INTEGER NOT NULL DEFAULT 1,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE mission_runtime_steps (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		step_key TEXT NOT NULL, state TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, checkpoint_seq INTEGER NOT NULL DEFAULT 0,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(run_id,step_key)
	)`,
	`CREATE TABLE mission_runtime_checkpoints (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, step_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		seq INTEGER NOT NULL, fencing_token INTEGER NOT NULL, state TEXT NOT NULL, evidence_id TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(step_id,seq)
	)`,
	`CREATE TABLE mission_runtime_actions (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, step_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		capability TEXT NOT NULL, action_type TEXT NOT NULL, target_hash TEXT NOT NULL, params_hash TEXT NOT NULL, authority_generation INTEGER NOT NULL DEFAULT 0,
		state TEXT NOT NULL, idempotency_key TEXT NOT NULL, outbound_message_id INTEGER, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		authority_context_hash TEXT NOT NULL DEFAULT '', UNIQUE(tenant_id,workspace_id,idempotency_key)
	)`,
	`CREATE TABLE mission_runtime_approvals (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, action_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		params_hash TEXT NOT NULL, authority_generation INTEGER NOT NULL, requester_id INTEGER NOT NULL, approver_id INTEGER, state TEXT NOT NULL,
		issued_at TEXT, expires_at TEXT, consumed_at TEXT, revoked_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		authority_context_hash TEXT NOT NULL DEFAULT ''
	)`,
	`CREATE TABLE mission_runtime_evidence (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, step_id TEXT NOT NULL, action_id TEXT, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		claim_key TEXT NOT NULL, source_type TEXT NOT NULL, status TEXT NOT NULL, reference_hash TEXT NOT NULL, summary_json TEXT NOT NULL DEFAULT '{}', observed_at TEXT NOT NULL, expires_at TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		evidence_type TEXT NOT NULL DEFAULT 'provider_observation', producer_type TEXT NOT NULL DEFAULT 'controlled_system', producer_id_hash TEXT NOT NULL DEFAULT '',
		integrity_hash TEXT NOT NULL DEFAULT '', sensitivity TEXT NOT NULL DEFAULT 'restricted_metadata', retention_class TEXT NOT NULL DEFAULT 'runtime_audit',
		valid_from TEXT, valid_until TEXT, superseded_at TEXT, revoked_at TEXT, version INTEGER NOT NULL DEFAULT 1,
		UNIQUE(tenant_id,workspace_id,reference_hash)
	)`,
	`CREATE TABLE mission_runtime_verifications (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, action_id TEXT, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		state TEXT NOT NULL, evidence_id TEXT NOT NULL, verifier TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		claim_id TEXT, policy_id TEXT, policy_version INTEGER, evidence_set_hash TEXT NOT NULL DEFAULT '', reason_codes_json TEXT NOT NULL DEFAULT '[]',
		integrity_state TEXT NOT NULL DEFAULT 'valid', version INTEGER NOT NULL DEFAULT 1
	)`,
	`CREATE TABLE mission_runtime_outcomes (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		state TEXT NOT NULL, verification_id TEXT NOT NULL, claim_key TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		action_id TEXT, policy_id TEXT, policy_version INTEGER, version INTEGER NOT NULL DEFAULT 1,
		UNIQUE(mission_id,claim_key)
	)`,
	`CREATE TABLE mission_runtime_events (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT, step_id TEXT, action_id TEXT,
		tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, event_type TEXT NOT NULL,
		from_state TEXT, to_state TEXT, expected_version INTEGER, fencing_token INTEGER,
		detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE mission_runtime_claims (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL, step_id TEXT NOT NULL,
		action_id TEXT, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		claim_key TEXT NOT NULL, claim_type TEXT NOT NULL, subject_hash TEXT NOT NULL,
		assertion_hash TEXT NOT NULL, required_evidence_json TEXT NOT NULL,
		policy_id TEXT NOT NULL, policy_version INTEGER NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
		version INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(mission_id, claim_key)
	)`,
	`CREATE TABLE mission_runtime_verification_policies (
		id TEXT NOT NULL, version INTEGER NOT NULL, claim_type TEXT NOT NULL,
		required_evidence_json TEXT NOT NULL, freshness_seconds INTEGER NOT NULL,
		minimum_distinct_evidence INTEGER NOT NULL DEFAULT 1, conflict_mode TEXT NOT NULL DEFAULT 'reject',
		active INTEGER NOT NULL DEFAULT 1, policy_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY(id, version)
	)`,
	`CREATE TABLE mission_runtime_evidence_relations (
		id TEXT PRIMARY KEY, evidence_id TEXT NOT NULL, related_evidence_id TEXT NOT NULL,
		tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		relation_type TEXT NOT NULL CHECK(relation_type IN ('supersedes','confirms','contradicts','duplicates','revokes')),
		reason_code TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(evidence_id, related_evidence_id, relation_type)
	)`,
	`CREATE TABLE mission_runtime_verification_evidence (
		verification_id TEXT NOT NULL, evidence_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		disposition TEXT NOT NULL CHECK(disposition IN ('used','rejected')),
		reason_code TEXT NOT NULL, evidence_integrity_hash TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		PRIMARY KEY(verification_id, evidence_id)
	)`,
	`CREATE TABLE mission_runtime_compensations (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT NOT NULL,
		original_action_id TEXT NOT NULL, compensation_action_id TEXT,
		tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		reason TEXT NOT NULL, authorization_reference TEXT NOT NULL,
		capability TEXT NOT NULL, provider_target_hash TEXT NOT NULL,
		attempt INTEGER NOT NULL DEFAULT 1, state TEXT NOT NULL DEFAULT 'pending'
		 CHECK(state IN ('pending','dispatched','observed','verified','failed')),
		observed_result TEXT, verification_result TEXT, evidence_ids_json TEXT NOT NULL DEFAULT '[]',
		started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT,
		final_state TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(mission_id, original_action_id, attempt)
	)`,
	`CREATE TABLE nexora_autonomy_jobs (
		id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, domain TEXT COLLATE NOCASE, job_type TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
		state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','RETRYING','SUCCEEDED','BLOCKED','FAILED')) DEFAULT 'QUEUED', attempt_count INTEGER NOT NULL DEFAULT 0,
		lease_until TEXT, input_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}', blocker_code TEXT, next_attempt_at TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
];

const TRIGGER_STATEMENTS = [
	`CREATE TRIGGER mission_runtime_evidence_no_update BEFORE UPDATE ON mission_runtime_evidence BEGIN SELECT RAISE(ABORT, 'mission_runtime_evidence_append_only'); END`,
	`CREATE TRIGGER mission_runtime_evidence_no_delete BEFORE DELETE ON mission_runtime_evidence BEGIN SELECT RAISE(ABORT, 'mission_runtime_evidence_append_only'); END`,
	`CREATE TRIGGER mission_runtime_claims_no_delete BEFORE DELETE ON mission_runtime_claims BEGIN SELECT RAISE(ABORT, 'mission_runtime_claim_history_append_only'); END`,
];

const TABLES = [
	'mission_runtime_missions', 'mission_runtime_runs', 'mission_runtime_steps', 'mission_runtime_checkpoints',
	'mission_runtime_actions', 'mission_runtime_approvals', 'mission_runtime_evidence', 'mission_runtime_verifications',
	'mission_runtime_outcomes', 'mission_runtime_events', 'mission_runtime_claims', 'mission_runtime_verification_policies',
	'mission_runtime_evidence_relations', 'mission_runtime_verification_evidence', 'mission_runtime_compensations', 'nexora_autonomy_jobs',
];

async function resetSchema() {
	await env.db.batch(TABLES.map((t) => env.db.prepare(`DROP TABLE IF EXISTS ${t}`)));
	for (const sql of SCHEMA_STATEMENTS) await env.db.prepare(sql).run();
	for (const sql of TRIGGER_STATEMENTS) await env.db.prepare(sql).run();
}

const c = { env };
const scope = { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID };

async function seedMissionRunStep({ missionId, runId, stepId, idempotencyKey, missionState = 'runnable', runState = 'runnable', stepState = 'runnable' }) {
	await env.db
		.prepare(`INSERT INTO mission_runtime_missions(id,tenant_id,workspace_id,user_id,kind,state,idempotency_key,claim_key) VALUES(?1,?2,?3,?2,'TEST_KIND',?4,?5,'test_claim')`)
		.bind(missionId, TENANT_ID, WORKSPACE_ID, missionState, idempotencyKey)
		.run();
	await env.db.prepare(`INSERT INTO mission_runtime_runs(id,mission_id,tenant_id,workspace_id,state) VALUES(?1,?2,?3,?4,?5)`).bind(runId, missionId, TENANT_ID, WORKSPACE_ID, runState).run();
	await env.db.prepare(`INSERT INTO mission_runtime_steps(id,mission_id,run_id,tenant_id,workspace_id,step_key,state) VALUES(?1,?2,?3,?4,?5,'only_step',?6)`).bind(stepId, missionId, runId, TENANT_ID, WORKSPACE_ID, stepState).run();
}

beforeEach(async () => {
	await resetSchema();
});

describe('NEXORA durable Mission Runtime — real-persistence verification (Checkpoint 4)', () => {
	it('E5/V3: restart recovery — an expired lease can be reclaimed by a new worker without duplicating state', async () => {
		await seedMissionRunStep({ missionId: 'm1', runId: 'r1', stepId: 's1', idempotencyKey: 'idem-1' });
		const first = await durableMissionRuntime.claimRun(c, scope, 'r1', 15);
		expect(first.state).toBe('running');
		expect(first.fencing_token).toBe(1);

		// Simulate a crashed worker: force the lease into the past (as if the process died
		// mid-run without releasing it) — this is what "restart recovery" must tolerate.
		await env.db.prepare(`UPDATE mission_runtime_runs SET lease_until=datetime('now','-1 minutes') WHERE id='r1'`).run();

		const second = await durableMissionRuntime.claimRun(c, scope, 'r1', 15);
		expect(second.state).toBe('running');
		expect(second.fencing_token).toBe(2); // fencing token advanced — old holder is now stale
		const row = await env.db.prepare(`SELECT * FROM mission_runtime_runs WHERE id='r1'`).first();
		expect(row.fencing_token).toBe(2);
	});

	it('E7/V5: a stale (unexpired-lease-holder) worker cannot claim a run already held by another worker', async () => {
		await seedMissionRunStep({ missionId: 'm2', runId: 'r2', stepId: 's2', idempotencyKey: 'idem-2' });
		await durableMissionRuntime.claimRun(c, scope, 'r2', 120); // active lease, ~2 minutes out
		await expect(durableMissionRuntime.claimRun(c, scope, 'r2', 120)).rejects.toThrow('mission_runtime_lease_conflict');
	});

	it('E11: duplicate mission submission is rejected at the database layer via idempotency_key UNIQUE', async () => {
		await env.db.prepare(`INSERT INTO mission_runtime_missions(id,tenant_id,workspace_id,user_id,kind,state,idempotency_key,claim_key) VALUES('m3',?1,?2,?1,'TEST_KIND','runnable','idem-dup','claim')`).bind(TENANT_ID, WORKSPACE_ID).run();
		await expect(
			env.db.prepare(`INSERT INTO mission_runtime_missions(id,tenant_id,workspace_id,user_id,kind,state,idempotency_key,claim_key) VALUES('m3-retry',?1,?2,?1,'TEST_KIND','runnable','idem-dup','claim')`).bind(TENANT_ID, WORKSPACE_ID).run(),
		).rejects.toThrow();
		const count = await env.db.prepare(`SELECT COUNT(*) n FROM mission_runtime_missions WHERE tenant_id=?1 AND workspace_id=?2 AND idempotency_key='idem-dup'`).bind(TENANT_ID, WORKSPACE_ID).first();
		expect(Number(count.n)).toBe(1); // second submission created no second row
	});

	it('E10/V6: duplicate checkpoint delivery (same expectedVersion twice) is rejected by optimistic concurrency, not silently repeated', async () => {
		await seedMissionRunStep({ missionId: 'm4', runId: 'r4', stepId: 's4', idempotencyKey: 'idem-4', runState: 'runnable', stepState: 'runnable' });
		const run = await durableMissionRuntime.claimRun(c, scope, 'r4');
		await env.db.prepare(`UPDATE mission_runtime_steps SET state='running' WHERE id='s4'`).run();
		const step = await env.db.prepare(`SELECT * FROM mission_runtime_steps WHERE id='s4'`).first();

		const seq = await durableMissionRuntime.checkpoint(c, scope, { stepId: 's4', runId: 'r4', fencingToken: run.fencing_token, expectedVersion: step.version });
		expect(seq).toBe(1);

		// Re-deliver the identical checkpoint request (simulating an at-least-once queue
		// redelivering the same message) with the now-STALE expectedVersion — must reject,
		// not silently re-apply.
		await expect(
			durableMissionRuntime.checkpoint(c, scope, { stepId: 's4', runId: 'r4', fencingToken: run.fencing_token, expectedVersion: step.version }),
		).rejects.toThrow('mission_runtime_checkpoint_conflict');
		const checkpoints = await env.db.prepare(`SELECT COUNT(*) n FROM mission_runtime_checkpoints WHERE step_id='s4'`).first();
		expect(Number(checkpoints.n)).toBe(1); // exactly one checkpoint row, not two
	});

	it('E12/V6: duplicate job delivery in nexora_autonomy_jobs cannot be claimed twice concurrently (real UPDATE...WHERE guard)', async () => {
		await env.db.prepare(`INSERT INTO nexora_autonomy_jobs(id,user_id,job_type,idempotency_key,state,input_json) VALUES(1,?1,'MISSION_RUNTIME_READONLY_PROBE','job-dup','QUEUED','{}')`).bind(TENANT_ID).run();
		const claimSql = `UPDATE nexora_autonomy_jobs SET state='RUNNING',attempt_count=attempt_count+1,lease_until=datetime('now','+2 minutes'),updated_at=CURRENT_TIMESTAMP WHERE id=1 AND job_type IN ('MISSION_RUNTIME_READONLY_PROBE','MISSION_RUNTIME_OUTBOUND_BOUNDARY_PROBE','MISSION_RUNTIME_POLICY_DENIAL_PROBE') AND (state IN ('QUEUED','RETRYING') OR (state='RUNNING' AND lease_until<CURRENT_TIMESTAMP))`;
		const first = await env.db.prepare(claimSql).run();
		expect(first.meta.changes).toBe(1);
		// A second, concurrent worker delivering the same job (duplicate delivery) must be
		// rejected by the same real predicate — the row is now RUNNING with a fresh lease.
		const second = await env.db.prepare(claimSql).run();
		expect(second.meta.changes).toBe(0);
	});

	it('E13: provider outage (job execution throws) preserves the job for safe recovery via FAILED, not silent loss or a false SUCCEEDED', async () => {
		await env.db.prepare(`INSERT INTO nexora_autonomy_jobs(id,user_id,job_type,idempotency_key,state,input_json) VALUES(2,?1,'MISSION_RUNTIME_READONLY_PROBE','job-outage','QUEUED',?2)`).bind(TENANT_ID, JSON.stringify({ tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, account_id: 990203 })).run();
		// No `account` or `gmail_provider_freshness` table exists in this minimal fixture, so
		// executeReadonlyGmailProbe's lookup throws — modeling an unavailable/outaged
		// dependency the same way a real provider outage would surface as an exception.
		const result = await durableMissionRuntime.monitorScheduled({ env }, { limit: 5 });
		expect(result.claimed).toBe(1);
		expect(result.succeeded).toBe(0);
		const job = await env.db.prepare(`SELECT state,blocker_code FROM nexora_autonomy_jobs WHERE id=2`).first();
		expect(job.state).toBe('FAILED');
		expect(job.blocker_code).toBe('MISSION_RUNTIME_READONLY_FAILED');
		// FAILED (not QUEUED/RETRYING) is a bounded terminal-with-blocker state here — it is
		// preserved (not deleted, not silently marked SUCCEEDED) for operator recovery.
	});

	it('E14/E24: evidence is append-only at the database layer — UPDATE and DELETE are physically rejected, not just avoided by convention', async () => {
		await env.db
			.prepare(`INSERT INTO mission_runtime_evidence(id,mission_id,run_id,step_id,tenant_id,workspace_id,claim_key,source_type,status,reference_hash,summary_json,observed_at,evidence_type) VALUES('ev1','m5','r5','s5',?1,?2,'claim','test_source','supported','hash-1','{}',CURRENT_TIMESTAMP,'provider_observation')`)
			.bind(TENANT_ID, WORKSPACE_ID)
			.run();
		await expect(env.db.prepare(`UPDATE mission_runtime_evidence SET status='rejected' WHERE id='ev1'`).run()).rejects.toThrow('mission_runtime_evidence_append_only');
		await expect(env.db.prepare(`DELETE FROM mission_runtime_evidence WHERE id='ev1'`).run()).rejects.toThrow('mission_runtime_evidence_append_only');
		const row = await env.db.prepare(`SELECT status FROM mission_runtime_evidence WHERE id='ev1'`).first();
		expect(row.status).toBe('supported'); // unchanged — the mutation attempts had zero effect
	});

	it('E26/V10: only verifyClaim + finalizeVerifiedOutcome (evidence-backed) can produce a completed mission; the executor cannot self-declare success', async () => {
		await seedMissionRunStep({ missionId: 'm6', runId: 'r6', stepId: 's6', idempotencyKey: 'idem-6' });
		const run = await durableMissionRuntime.claimRun(c, scope, 'r6');
		await env.db.prepare(`UPDATE mission_runtime_missions SET state='verification_pending' WHERE id='m6'`).run();

		const policyId = 'test-policy';
		await env.db
			.prepare(`INSERT INTO mission_runtime_verification_policies(id,version,claim_type,required_evidence_json,freshness_seconds,minimum_distinct_evidence,conflict_mode,policy_hash) VALUES(?1,1,'test_claim','["provider_observation"]',900,1,'reject','hash')`)
			.bind(policyId)
			.run();
		await env.db
			.prepare(`INSERT INTO mission_runtime_claims(id,mission_id,run_id,step_id,tenant_id,workspace_id,claim_key,claim_type,subject_hash,assertion_hash,required_evidence_json,policy_id,policy_version) VALUES('c6','m6','r6','s6',?1,?2,'test_claim','test_claim','subj','assert','["provider_observation"]',?3,1)`)
			.bind(TENANT_ID, WORKSPACE_ID, policyId)
			.run();

		// Attempting to jump straight to complete() without a verified outcome must fail —
		// there is no path for a caller to hand-write a 'completed' mission state directly;
		// complete() re-derives correctness from the outcome/verification/evidence chain.
		await expect(
			durableMissionRuntime.complete(c, scope, { missionId: 'm6', runId: 'r6', outcomeId: 'nonexistent-outcome', expectedVersion: 1, fencingToken: run.fencing_token }),
		).rejects.toThrow();

		// No evidence recorded yet -> verification must be inconclusive, not verified.
		const noEvidence = await durableMissionRuntime.verifyClaim(c, scope, { claimId: 'c6', runId: 'r6' });
		expect(noEvidence.state).toBe('inconclusive');
		await expect(
			durableMissionRuntime.finalizeVerifiedOutcome(c, scope, { missionId: 'm6', runId: 'r6', actionId: null, claimId: 'c6', verificationId: noEvidence.verificationId, expectedVersion: 1, fencingToken: run.fencing_token }),
		).rejects.toThrow('mission_runtime_evidence_insufficient');

		// Now record real supporting evidence and re-verify — only THEN can the mission complete.
		// integrity_hash must match the service's own integrityEnvelope() computation (the
		// same field set hashed by materialize's evaluateEvidence integrity check) or the
		// evidence is correctly treated as tampered/invalid — this is real integrity
		// enforcement, not a fixture convenience.
		const observedAt = new Date().toISOString(); // must be fresh (< policy.freshness_seconds old)
		const evidenceRow = { id: 'ev6', mission_id: 'm6', run_id: 'r6', step_id: 's6', action_id: null, tenant_id: TENANT_ID, workspace_id: WORKSPACE_ID, claim_key: 'test_claim', evidence_type: 'provider_observation', source_type: 'test_source', producer_type: 'controlled_system', producer_id_hash: '', reference_hash: 'hash-ev6', summary_json: '{}', observed_at: observedAt, expires_at: null };
		const integrityHash = await hash(evidenceRow);
		await env.db
			.prepare(`INSERT INTO mission_runtime_evidence(id,mission_id,run_id,step_id,tenant_id,workspace_id,claim_key,source_type,status,reference_hash,summary_json,observed_at,evidence_type,integrity_hash) VALUES('ev6','m6','r6','s6',?1,?2,'test_claim','test_source','supported','hash-ev6','{}',?3,'provider_observation',?4)`)
			.bind(TENANT_ID, WORKSPACE_ID, observedAt, integrityHash)
			.run();
		const verified = await durableMissionRuntime.verifyClaim(c, scope, { claimId: 'c6', runId: 'r6' });
		expect(verified.state).toBe('verified');
		const outcomeId = await durableMissionRuntime.finalizeVerifiedOutcome(c, scope, { missionId: 'm6', runId: 'r6', actionId: null, claimId: 'c6', verificationId: verified.verificationId, expectedVersion: 1, fencingToken: run.fencing_token });
		expect(typeof outcomeId).toBe('string');
		const mission = await env.db.prepare(`SELECT state FROM mission_runtime_missions WHERE id='m6'`).first();
		expect(mission.state).toBe('completed');
	});

	it('V4: illegal state transitions are rejected for both mission and step entities (guard is real, not decorative)', () => {
		expect(allowed('mission', 'created', 'completed')).toBe(false);
		expect(allowed('mission', 'verification_pending', 'created')).toBe(false);
		expect(allowed('step', 'checkpointed', 'checkpointed')).toBe(false); // self-transition not in the legal set
		expect(allowed('step', 'completed', 'running')).toBe(false); // 'completed' has no entry in STATES.step -> no legal transitions out
	});

	it('cancellation before execution: a runnable mission can be cancelled without ever entering running/verification_pending', () => {
		expect(allowed('mission', 'created', 'cancelled')).toBe(true);
		expect(allowed('mission', 'runnable', 'cancelled')).toBe(true);
		expect(allowed('mission', 'cancelled', 'running')).toBe(false); // terminal-state protection
	});
});

describe('NEXORA Mission Runtime operational visibility (Required Output #11)', () => {
	it('reflects authoritative runtime state: current step/checkpoint, blocked reason, evidence refs, retry eligibility', async () => {
		await seedMissionRunStep({ missionId: 'v1', runId: 'vr1', stepId: 'vs1', idempotencyKey: 'videm-1', missionState: 'blocked', runState: 'runnable', stepState: 'runnable' });
		await env.db
			.prepare(`INSERT INTO mission_runtime_events(id,mission_id,run_id,step_id,tenant_id,workspace_id,event_type,to_state,detail_json) VALUES('evt1','v1','vr1','vs1',?1,?2,'DISPATCH_DENIED','blocked','{"result":"policy_denied","reason_codes":["controlled_production_policy_denied"]}')`)
			.bind(TENANT_ID, WORKSPACE_ID)
			.run();
		await env.db
			.prepare(`INSERT INTO mission_runtime_evidence(id,mission_id,run_id,step_id,tenant_id,workspace_id,claim_key,source_type,status,reference_hash,summary_json,observed_at,evidence_type) VALUES('evv1','v1','vr1','vs1',?1,?2,'claim','test_source','supported','hash-v1','{}',CURRENT_TIMESTAMP,'provider_observation')`)
			.bind(TENANT_ID, WORKSPACE_ID)
			.run();

		const status = await missionRuntimeStatusService.missionStatus(c, { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID }, 'v1');
		expect(status.status).toBe('blocked');
		expect(status.current_step.step_id).toBe('vs1');
		expect(status.blocked_reason.eventType).toBe('DISPATCH_DENIED');
		expect(status.blocked_reason.detail.result).toBe('policy_denied');
		expect(status.evidence_references).toHaveLength(1);
		expect(status.evidence_references[0].evidence_id).toBe('evv1');
		expect(status.compensation_state).toBe('not_requested'); // compensation is now implemented; none was requested for this mission
		expect(status.final_verdict).toBeNull(); // not a terminal state yet
	});

	it('rejects cross-tenant/cross-workspace status queries (no data leak across scope)', async () => {
		await seedMissionRunStep({ missionId: 'v2', runId: 'vr2', stepId: 'vs2', idempotencyKey: 'videm-2' });
		await expect(missionRuntimeStatusService.missionStatus(c, { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID + 1 }, 'v2')).rejects.toThrow('mission_runtime_status_scope_denied');
		await expect(missionRuntimeStatusService.missionStatus(c, { tenantId: TENANT_ID + 1, workspaceId: WORKSPACE_ID }, 'v2')).rejects.toThrow('mission_runtime_status_scope_denied');
	});

	it('reports a completed mission with its final verdict and retry_eligible=false once terminal', async () => {
		await seedMissionRunStep({ missionId: 'v3', runId: 'vr3', stepId: 'vs3', idempotencyKey: 'videm-3', missionState: 'completed' });
		await env.db.prepare(`UPDATE mission_runtime_runs SET state='running' WHERE id='vr3'`).run();
		await env.db.prepare(`INSERT INTO mission_runtime_verifications(id,mission_id,run_id,tenant_id,workspace_id,state,evidence_id,verifier) VALUES('vv3','v3','vr3',?1,?2,'verified','ev-x','deterministic_evidence_policy_v1')`).bind(TENANT_ID, WORKSPACE_ID).run();
		await env.db.prepare(`INSERT INTO mission_runtime_outcomes(id,mission_id,tenant_id,workspace_id,state,verification_id,claim_key) VALUES('vo3','v3',?1,?2,'verified','vv3','test_claim')`).bind(TENANT_ID, WORKSPACE_ID).run();

		const status = await missionRuntimeStatusService.missionStatus(c, { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID }, 'v3');
		expect(status.final_verdict.state).toBe('verified');
		expect(status.final_verdict.outcome_id).toBe('vo3');
	});
});

describe('NEXORA Mission Runtime compensation (Checkpoint 2 — closes the confirmed COMPENSATING/COMPENSATED gap)', () => {
	async function seedRunningMissionWithAction({ missionId, runId, stepId, actionId, idempotencyKey }) {
		await seedMissionRunStep({ missionId, runId, stepId, idempotencyKey, missionState: 'running', runState: 'runnable', stepState: 'runnable' });
		await durableMissionRuntime.claimRun(c, scope, runId);
		await env.db
			.prepare(`INSERT INTO mission_runtime_actions(id,mission_id,run_id,step_id,tenant_id,workspace_id,capability,action_type,target_hash,params_hash,state,idempotency_key) VALUES(?1,?2,?3,?4,?5,?6,'test_capability','TEST_WRITE','target-hash','params-hash','completed',?7)`)
			.bind(actionId, missionId, runId, stepId, TENANT_ID, WORKSPACE_ID, `${idempotencyKey}:action`)
			.run();
	}

	it('E7/V1-V4: a reversible compensation runs through begin -> dispatch -> observe -> verify against real D1, and only a verified observation can mark it compensated', async () => {
		await seedRunningMissionWithAction({ missionId: 'k1', runId: 'kr1', stepId: 'ks1', actionId: 'ka1', idempotencyKey: 'kidem-1' });
		const run = await env.db.prepare(`SELECT * FROM mission_runtime_runs WHERE id='kr1'`).first();
		const mission = await env.db.prepare(`SELECT * FROM mission_runtime_missions WHERE id='k1'`).first();

		const compensationId = await durableMissionRuntime.beginCompensation(c, scope, {
			missionId: 'k1', runId: 'kr1', fencingToken: run.fencing_token, expectedVersion: mission.version,
			originalActionId: 'ka1', reason: 'test_reversal', authorizationReference: 'auth-ref-1', capability: 'test_capability', providerTargetHash: 'target-hash',
		});
		expect(typeof compensationId).toBe('string');
		const afterBegin = await env.db.prepare(`SELECT state,version FROM mission_runtime_missions WHERE id='k1'`).first();
		expect(afterBegin.state).toBe('compensating');

		// V2: an unauthorized shortcut straight to verify without dispatch/observe first must fail.
		await expect(
			durableMissionRuntime.verifyAndCompleteCompensation(c, scope, { compensationId, missionId: 'k1', runId: 'kr1', fencingToken: run.fencing_token, expectedVersion: afterBegin.version, verified: true, verificationResult: { skip: true } }),
		).rejects.toThrow('mission_runtime_compensation_verification_conflict');

		await durableMissionRuntime.dispatchCompensation(c, scope, { compensationId, compensationActionId: 'ka1-reversal' });
		await durableMissionRuntime.observeCompensation(c, scope, { compensationId, observedResult: { reversed: true, provider_ack: 'synthetic-ack' } });

		const outcome = await durableMissionRuntime.verifyAndCompleteCompensation(c, scope, {
			compensationId, missionId: 'k1', runId: 'kr1', fencingToken: run.fencing_token, expectedVersion: afterBegin.version,
			verified: true, verificationResult: { independently_confirmed: true }, evidenceIds: ['ev-comp-1'],
		});
		expect(outcome.missionState).toBe('compensated');
		expect(outcome.compensationState).toBe('verified');

		const finalMission = await env.db.prepare(`SELECT state FROM mission_runtime_missions WHERE id='k1'`).first();
		expect(finalMission.state).toBe('compensated');
		const compRow = await env.db.prepare(`SELECT state,final_state,completed_at FROM mission_runtime_compensations WHERE id=?1`).bind(compensationId).first();
		expect(compRow.state).toBe('verified');
		expect(compRow.final_state).toBe('compensated');
		expect(compRow.completed_at).not.toBeNull();

		// COMPENSATED is terminal: no further legal transition out.
		expect(allowed('mission', 'compensated', 'running')).toBe(false);
		expect(allowed('mission', 'compensated', 'compensating')).toBe(false);
	});

	it('V1/failure path: a compensation that fails independent verification drives the mission to failed, not compensated', async () => {
		await seedRunningMissionWithAction({ missionId: 'k2', runId: 'kr2', stepId: 'ks2', actionId: 'ka2', idempotencyKey: 'kidem-2' });
		const run = await env.db.prepare(`SELECT * FROM mission_runtime_runs WHERE id='kr2'`).first();
		const mission = await env.db.prepare(`SELECT * FROM mission_runtime_missions WHERE id='k2'`).first();
		const compensationId = await durableMissionRuntime.beginCompensation(c, scope, { missionId: 'k2', runId: 'kr2', fencingToken: run.fencing_token, expectedVersion: mission.version, originalActionId: 'ka2', reason: 'test_reversal', authorizationReference: 'auth-ref-2', capability: 'test_capability', providerTargetHash: 'target-hash' });
		await durableMissionRuntime.dispatchCompensation(c, scope, { compensationId, compensationActionId: 'ka2-reversal' });
		await durableMissionRuntime.observeCompensation(c, scope, { compensationId, observedResult: { reversed: false, error: 'provider_rejected_reversal' } });

		const afterBegin = await env.db.prepare(`SELECT version FROM mission_runtime_missions WHERE id='k2'`).first();
		const outcome = await durableMissionRuntime.verifyAndCompleteCompensation(c, scope, { compensationId, missionId: 'k2', runId: 'kr2', fencingToken: run.fencing_token, expectedVersion: afterBegin.version, verified: false, verificationResult: { independently_confirmed: false } });
		expect(outcome.missionState).toBe('failed');
		const finalMission = await env.db.prepare(`SELECT state FROM mission_runtime_missions WHERE id='k2'`).first();
		expect(finalMission.state).toBe('failed');
	});

	it('V1: illegal compensation transitions are rejected — cannot compensate from created/cancelled/compensated', () => {
		expect(allowed('mission', 'created', 'compensating')).toBe(false);
		expect(allowed('mission', 'cancelled', 'compensating')).toBe(false);
		expect(allowed('mission', 'compensated', 'compensating')).toBe(false);
		expect(allowed('mission', 'running', 'compensating')).toBe(true);
		expect(allowed('mission', 'failed', 'compensating')).toBe(true); // legal only where the caller's policy permits it
	});

	it('E24: compensation never mutates the original action evidence — append-only enforcement still holds during a compensation flow', async () => {
		await seedRunningMissionWithAction({ missionId: 'k3', runId: 'kr3', stepId: 'ks3', actionId: 'ka3', idempotencyKey: 'kidem-3' });
		await env.db
			.prepare(`INSERT INTO mission_runtime_evidence(id,mission_id,run_id,step_id,action_id,tenant_id,workspace_id,claim_key,source_type,status,reference_hash,summary_json,observed_at,evidence_type) VALUES('ev-orig-3','k3','kr3','ks3','ka3',?1,?2,'claim','test_source','supported','hash-orig-3','{}',CURRENT_TIMESTAMP,'provider_observation')`)
			.bind(TENANT_ID, WORKSPACE_ID)
			.run();
		const run = await env.db.prepare(`SELECT * FROM mission_runtime_runs WHERE id='kr3'`).first();
		const mission = await env.db.prepare(`SELECT * FROM mission_runtime_missions WHERE id='k3'`).first();
		await durableMissionRuntime.beginCompensation(c, scope, { missionId: 'k3', runId: 'kr3', fencingToken: run.fencing_token, expectedVersion: mission.version, originalActionId: 'ka3', reason: 'test_reversal', authorizationReference: 'auth-ref-3', capability: 'test_capability', providerTargetHash: 'target-hash' });
		await expect(env.db.prepare(`UPDATE mission_runtime_evidence SET status='rejected' WHERE id='ev-orig-3'`).run()).rejects.toThrow('mission_runtime_evidence_append_only');
		const original = await env.db.prepare(`SELECT status FROM mission_runtime_evidence WHERE id='ev-orig-3'`).first();
		expect(original.status).toBe('supported'); // original action evidence is untouched by compensation
	});
});
