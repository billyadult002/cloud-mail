// NEXORA Zero-Touch onboarding: automatic initial synchronization orchestration — real D1.
// Verifies dispatch preconditions, foreground-before-background ordering, independent
// verification before CONNECTED, restart-safe job claiming, and degraded/failed recovery
// paths, all against an injectable adapter (no real Gmail/Graph API call in this pass).
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import onboardingSync from '../../src/service/nexora-onboarding-sync-service.js';
import onboardingStateMachine, { allowed } from '../../src/service/nexora-onboarding-state-machine.js';

const TENANT_ID = 990901;
const WORKSPACE_ID = 990902;

const SCHEMA = [
	`CREATE TABLE nexora_onboarding_state (
		mission_id TEXT PRIMARY KEY, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		target_provider TEXT NOT NULL, target_account_or_domain_hash TEXT NOT NULL,
		discovery_state TEXT NOT NULL DEFAULT 'discovering', authorization_state TEXT NOT NULL DEFAULT 'not_started',
		approval_state TEXT NOT NULL DEFAULT 'not_required', connection_state TEXT NOT NULL DEFAULT 'not_connected',
		capability_state TEXT NOT NULL DEFAULT 'not_discovered', sync_state TEXT NOT NULL DEFAULT 'not_started',
		verification_state TEXT NOT NULL DEFAULT 'not_verified', blocked_reason TEXT, required_human_actor TEXT,
		resume_token TEXT, final_verdict TEXT, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		phase TEXT NOT NULL DEFAULT 'discovering' CHECK(phase IN (
			'discovering','provider_identified','authorization_path_selected',
			'waiting_for_user_login','waiting_for_user_consent','waiting_for_admin_consent','waiting_for_provider_review',
			'authorization_received','validating_authority','discovering_capabilities','provisioning',
			'verifying_connection','starting_initial_sync','verifying_initial_sync',
			'connected','degraded','blocked','failed','cancelled'
		)),
		phase_version INTEGER NOT NULL DEFAULT 1
	)`,
	`CREATE TABLE nexora_autonomy_jobs (
		id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, domain TEXT COLLATE NOCASE, job_type TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
		state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','RETRYING','SUCCEEDED','BLOCKED','FAILED')) DEFAULT 'QUEUED', attempt_count INTEGER NOT NULL DEFAULT 0,
		lease_until TEXT, input_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}', blocker_code TEXT, next_attempt_at TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
];
const TABLES = ['nexora_onboarding_state', 'nexora_autonomy_jobs'];

async function resetSchema() {
	await env.db.batch(TABLES.map((t) => env.db.prepare(`DROP TABLE IF EXISTS ${t}`)));
	for (const sql of SCHEMA) await env.db.prepare(sql).run();
}

const c = { env };
const scope = { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID };

async function seedAtAuthorizationReceived(missionId) {
	await onboardingStateMachine.ensureOnboardingState(c, scope, { missionId, targetProvider: 'google', targetAccountOrDomainHash: 'hash' });
	for (const to of ['provider_identified', 'authorization_path_selected', 'waiting_for_user_login', 'waiting_for_user_consent', 'authorization_received']) {
		await onboardingStateMachine.advancePhase(c, scope, { missionId, to });
	}
}

beforeEach(async () => {
	await resetSchema();
});

describe('Initial sync dispatch — preconditions and phase progression', () => {
	it('V29: refuses to dispatch sync before capability discovery reports mail_read as SUPPORTED', async () => {
		await seedAtAuthorizationReceived('ob-sync-1');
		await expect(onboardingSync.dispatchInitialSync(c, scope, { missionId: 'ob-sync-1', capabilityStates: { mail_read: 'CONSENT_REQUIRED' } })).rejects.toThrow('nexora_onboarding_sync_capability_not_supported');
		const phase = await env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id='ob-sync-1'`).first();
		expect(phase.phase).toBe('authorization_received'); // never advanced
	});

	it('E25/V21-23: a valid dispatch advances the phase through validating_authority -> starting_initial_sync and enqueues exactly one job', async () => {
		await seedAtAuthorizationReceived('ob-sync-2');
		const result = await onboardingSync.dispatchInitialSync(c, scope, { missionId: 'ob-sync-2', capabilityStates: { mail_read: 'SUPPORTED' } });
		expect(result.dispatched).toBe(true);
		const phase = await env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id='ob-sync-2'`).first();
		expect(phase.phase).toBe('starting_initial_sync');
		const jobs = await env.db.prepare(`SELECT COUNT(*) n FROM nexora_autonomy_jobs WHERE job_type='ZERO_TOUCH_INITIAL_SYNC' AND idempotency_key='sync:ob-sync-2'`).first();
		expect(Number(jobs.n)).toBe(1);
	});

	it('dispatch is idempotent: calling twice does not create a second job (duplicate-delivery safety, Required Output #25)', async () => {
		await seedAtAuthorizationReceived('ob-sync-3');
		await onboardingSync.dispatchInitialSync(c, scope, { missionId: 'ob-sync-3', capabilityStates: { mail_read: 'SUPPORTED' } });
		// Second call: phase is already past validating_authority, so the advance loop is a
		// no-op (allowed() guards skip already-passed states), and INSERT OR IGNORE dedupes the job.
		await onboardingSync.dispatchInitialSync(c, scope, { missionId: 'ob-sync-3', capabilityStates: { mail_read: 'SUPPORTED' } });
		const jobs = await env.db.prepare(`SELECT COUNT(*) n FROM nexora_autonomy_jobs WHERE idempotency_key='sync:ob-sync-3'`).first();
		expect(Number(jobs.n)).toBe(1);
	});
});

describe('Scheduled sync execution — foreground-before-background, independent verification, restart-safety', () => {
	async function dispatchedMission(id) {
		await seedAtAuthorizationReceived(id);
		await onboardingSync.dispatchInitialSync(c, scope, { missionId: id, capabilityStates: { mail_read: 'SUPPORTED' } });
		return id;
	}

	it('E26/E27/V13/V27/V28: a successful adapter run reaches CONNECTED only after foreground readiness AND background enqueue are both independently confirmed', async () => {
		const missionId = await dispatchedMission('ob-sync-4');
		const result = await onboardingSync.runScheduledSync({ env }, { adapter: async () => ({ foregroundReady: true, foregroundMessageCount: 12, backgroundEnqueued: true, backgroundJobId: 'bg-1' }) });
		expect(result.claimed).toBe(1);
		expect(result.succeeded).toBe(1);
		const state = await env.db.prepare(`SELECT phase,sync_state,verification_state,connection_state FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
		expect(state.phase).toBe('connected');
		expect(state.verification_state).toBe('verified');
		const job = await env.db.prepare(`SELECT state,result_json FROM nexora_autonomy_jobs WHERE idempotency_key='sync:ob-sync-4'`).first();
		expect(job.state).toBe('SUCCEEDED');
		expect(JSON.parse(job.result_json).verified).toBe(true);
	});

	it('V28: foreground readiness alone (no background confirmation) reaches DEGRADED, not falsely CONNECTED', async () => {
		const missionId = await dispatchedMission('ob-sync-5');
		await onboardingSync.runScheduledSync({ env }, { adapter: async () => ({ foregroundReady: true, backgroundEnqueued: false }) });
		const state = await env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
		expect(state.phase).toBe('degraded');
	});

	it('a foreground-not-ready adapter result fails the sync cleanly (not silently marked connected)', async () => {
		const missionId = await dispatchedMission('ob-sync-6');
		const result = await onboardingSync.runScheduledSync({ env }, { adapter: async () => ({ foregroundReady: false }) });
		expect(result.failed).toBe(1);
		const state = await env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
		expect(state.phase).toBe('failed');
		const job = await env.db.prepare(`SELECT state,blocker_code FROM nexora_autonomy_jobs WHERE idempotency_key='sync:ob-sync-6'`).first();
		expect(job.state).toBe('FAILED');
		expect(job.blocker_code).toBe('ZERO_TOUCH_INITIAL_SYNC_FAILED');
	});

	it('E30/V8: restart-safety — a job claimed by a crashed worker (expired lease) is reclaimed and completes exactly once, no duplicate SUCCEEDED result', async () => {
		const missionId = await dispatchedMission('ob-sync-7');
		// Simulate a worker that claimed the job but crashed before finishing: force the lease
		// into the past as if the process died mid-run.
		await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='RUNNING',lease_until=datetime('now','-1 minutes') WHERE idempotency_key='sync:ob-sync-7'`).run();
		const result = await onboardingSync.runScheduledSync({ env }, { adapter: async () => ({ foregroundReady: true, backgroundEnqueued: true }) });
		expect(result.claimed).toBe(1);
		expect(result.succeeded).toBe(1);
		const state = await env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
		expect(state.phase).toBe('connected');

		// A second scheduled run against the now-SUCCEEDED job must claim nothing (no
		// duplicate synchronization delivery, Required Output #35).
		const second = await onboardingSync.runScheduledSync({ env }, { adapter: async () => ({ foregroundReady: true, backgroundEnqueued: true }) });
		expect(second.claimed).toBe(0);
	});

	it('an unexpired lease held by another worker cannot be double-claimed concurrently', async () => {
		await dispatchedMission('ob-sync-8');
		await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='RUNNING',lease_until=datetime('now','+2 minutes') WHERE idempotency_key='sync:ob-sync-8'`).run();
		const result = await onboardingSync.runScheduledSync({ env }, { adapter: async () => ({ foregroundReady: true, backgroundEnqueued: true }) });
		expect(result.claimed).toBe(0); // active lease respected
	});
});
