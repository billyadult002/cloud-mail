// NEXORA Zero-Touch onboarding 18-state phase machine — real pool-workers D1 verification.
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import onboardingStateMachine, { ONBOARDING_STATES, allowed, assertTransition, isTerminal } from '../../src/service/nexora-onboarding-state-machine.js';

const TENANT_ID = 990401;
const WORKSPACE_ID = 990402;

const SCHEMA = `CREATE TABLE nexora_onboarding_state (
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
)`;
const EVENTS_SCHEMA = `CREATE TABLE mission_runtime_events (
	id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT, step_id TEXT, action_id TEXT,
	tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, event_type TEXT NOT NULL,
	from_state TEXT, to_state TEXT, expected_version INTEGER, fencing_token INTEGER,
	detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

async function resetSchema() {
	await env.db.batch([env.db.prepare(`DROP TABLE IF EXISTS nexora_onboarding_state`), env.db.prepare(`DROP TABLE IF EXISTS mission_runtime_events`)]);
	await env.db.prepare(SCHEMA).run();
	await env.db.prepare(EVENTS_SCHEMA).run();
}

const c = { env };
const scope = { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID };

beforeEach(async () => {
	await resetSchema();
});

describe('18-state onboarding phase machine — legal/illegal transitions (deterministic)', () => {
	it('covers all 19 named phases (>= the 18 required, discovering is entry)', () => {
		expect(Object.keys(ONBOARDING_STATES)).toHaveLength(19);
		for (const phase of ['discovering', 'provider_identified', 'authorization_path_selected', 'waiting_for_user_login', 'waiting_for_user_consent', 'waiting_for_admin_consent', 'waiting_for_provider_review', 'authorization_received', 'validating_authority', 'discovering_capabilities', 'provisioning', 'verifying_connection', 'starting_initial_sync', 'verifying_initial_sync', 'connected', 'degraded', 'blocked', 'failed', 'cancelled']) {
			expect(ONBOARDING_STATES).toHaveProperty(phase);
		}
	});

	it('allows the happy-path progression end to end', () => {
		const path = ['discovering', 'provider_identified', 'authorization_path_selected', 'waiting_for_user_login', 'waiting_for_user_consent', 'authorization_received', 'validating_authority', 'discovering_capabilities', 'provisioning', 'verifying_connection', 'starting_initial_sync', 'verifying_initial_sync', 'connected'];
		for (let i = 0; i < path.length - 1; i++) expect(allowed(path[i], path[i + 1])).toBe(true);
	});

	it('rejects illegal transitions (skipping validation, or leaving a terminal state)', () => {
		expect(allowed('discovering', 'connected')).toBe(false); // cannot skip the entire flow
		expect(allowed('failed', 'discovering')).toBe(false); // failed is terminal; a new Mission is required
		expect(allowed('cancelled', 'connected')).toBe(false);
		expect(() => assertTransition('failed', 'connected')).toThrow('nexora_onboarding_phase_transition_rejected');
	});

	it('supports the automatic-repair loop: connected -> degraded -> validating_authority -> ... -> connected', () => {
		expect(allowed('connected', 'degraded')).toBe(true);
		expect(allowed('degraded', 'validating_authority')).toBe(true);
		expect(allowed('degraded', 'connected')).toBe(true); // direct repair without full re-discovery
	});

	it('isTerminal reports the three outcome phases', () => {
		expect(isTerminal('connected')).toBe(true);
		expect(isTerminal('failed')).toBe(true);
		expect(isTerminal('cancelled')).toBe(true);
		expect(isTerminal('discovering')).toBe(false);
	});
});

describe('Real D1 phase persistence — restart-safe, optimistic-concurrency guarded', () => {
	it('ensureOnboardingState is idempotent (INSERT OR IGNORE) and phase advances persist across a fresh read', async () => {
		const row1 = await onboardingStateMachine.ensureOnboardingState(c, scope, { missionId: 'ob-sm-1', targetProvider: 'google', targetAccountOrDomainHash: 'hash-1' });
		expect(row1.phase).toBe('discovering');
		const row2 = await onboardingStateMachine.ensureOnboardingState(c, scope, { missionId: 'ob-sm-1', targetProvider: 'google', targetAccountOrDomainHash: 'hash-1' });
		expect(row2.mission_id).toBe('ob-sm-1'); // second call is a no-op, not a duplicate row

		await onboardingStateMachine.advancePhase(c, scope, { missionId: 'ob-sm-1', to: 'provider_identified' });
		// Simulate restart: fresh, independent read.
		const reread = await env.db.prepare(`SELECT phase,phase_version FROM nexora_onboarding_state WHERE mission_id='ob-sm-1'`).first();
		expect(reread.phase).toBe('provider_identified');
		expect(reread.phase_version).toBe(2);
	});

	it('rejects an illegal phase advance at the persistence layer, not just in the pure guard', async () => {
		await onboardingStateMachine.ensureOnboardingState(c, scope, { missionId: 'ob-sm-2', targetProvider: 'microsoft', targetAccountOrDomainHash: 'hash-2' });
		await expect(onboardingStateMachine.advancePhase(c, scope, { missionId: 'ob-sm-2', to: 'connected' })).rejects.toThrow('nexora_onboarding_phase_transition_rejected');
		const row = await env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id='ob-sm-2'`).first();
		expect(row.phase).toBe('discovering'); // unchanged
	});

	it('records blocked_reason/required_human_actor/resume_token on a blocking transition, real D1', async () => {
		await onboardingStateMachine.ensureOnboardingState(c, scope, { missionId: 'ob-sm-3', targetProvider: 'microsoft', targetAccountOrDomainHash: 'hash-3' });
		await onboardingStateMachine.advancePhase(c, scope, { missionId: 'ob-sm-3', to: 'provider_identified' });
		await onboardingStateMachine.advancePhase(c, scope, { missionId: 'ob-sm-3', to: 'authorization_path_selected' });
		await onboardingStateMachine.advancePhase(c, scope, { missionId: 'ob-sm-3', to: 'blocked', blockedReason: 'PROVIDER_APPLICATION_MISSING', requiredHumanActor: 'workspace_administrator', resumeToken: 'resume:ob-sm-3' });
		const row = await env.db.prepare(`SELECT phase,blocked_reason,required_human_actor,resume_token FROM nexora_onboarding_state WHERE mission_id='ob-sm-3'`).first();
		expect(row.phase).toBe('blocked');
		expect(row.blocked_reason).toBe('PROVIDER_APPLICATION_MISSING');
		expect(row.required_human_actor).toBe('workspace_administrator');
		expect(row.resume_token).toBe('resume:ob-sm-3');
	});

	it('a concurrent duplicate advance attempt (stale phase_version) is rejected — no double-progress', async () => {
		await onboardingStateMachine.ensureOnboardingState(c, scope, { missionId: 'ob-sm-4', targetProvider: 'google', targetAccountOrDomainHash: 'hash-4' });
		const first = onboardingStateMachine.advancePhase(c, scope, { missionId: 'ob-sm-4', to: 'provider_identified' });
		const second = onboardingStateMachine.advancePhase(c, scope, { missionId: 'ob-sm-4', to: 'provider_identified' });
		const results = await Promise.allSettled([first, second]);
		const fulfilled = results.filter((r) => r.status === 'fulfilled');
		const rejected = results.filter((r) => r.status === 'rejected');
		expect(fulfilled).toHaveLength(1);
		expect(rejected).toHaveLength(1);
		const row = await env.db.prepare(`SELECT phase_version FROM nexora_onboarding_state WHERE mission_id='ob-sm-4'`).first();
		expect(row.phase_version).toBe(2); // advanced exactly once, not twice
	});

	it('E5: every material phase transition is persisted as evidence in mission_runtime_events, correlated to the mission', async () => {
		await onboardingStateMachine.ensureOnboardingState(c, scope, { missionId: 'ob-sm-6', targetProvider: 'google', targetAccountOrDomainHash: 'hash-6' });
		await onboardingStateMachine.advancePhase(c, scope, { missionId: 'ob-sm-6', to: 'provider_identified' });
		await onboardingStateMachine.advancePhase(c, scope, { missionId: 'ob-sm-6', to: 'authorization_path_selected' });
		const rows = await env.db.prepare(`SELECT event_type,from_state,to_state FROM mission_runtime_events WHERE mission_id='ob-sm-6' ORDER BY created_at`).all();
		expect(rows.results).toHaveLength(2);
		expect(rows.results[0]).toEqual({ event_type: 'ONBOARDING_PHASE_TRANSITION', from_state: 'discovering', to_state: 'provider_identified' });
		expect(rows.results[1]).toEqual({ event_type: 'ONBOARDING_PHASE_TRANSITION', from_state: 'provider_identified', to_state: 'authorization_path_selected' });
	});

	it('cross-tenant scope is enforced on advancePhase', async () => {
		await onboardingStateMachine.ensureOnboardingState(c, scope, { missionId: 'ob-sm-5', targetProvider: 'google', targetAccountOrDomainHash: 'hash-5' });
		await expect(onboardingStateMachine.advancePhase(c, { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID + 1 }, { missionId: 'ob-sm-5', to: 'provider_identified' })).rejects.toThrow('nexora_onboarding_scope_denied');
	});
});
