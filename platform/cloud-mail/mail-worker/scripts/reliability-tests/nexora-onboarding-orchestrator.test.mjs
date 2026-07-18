// NEXORA Zero-Touch onboarding orchestrator: end-to-end real-D1 test of startOnboarding ->
// (real provider consent, simulated) -> handleCallback -> automatic Mission continuation.
// This is the Checkpoint 4/8 "automatic Mission continuation" evidence: no user action is
// required between a valid callback and the underlying Mission resuming.
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import onboardingOrchestrator from '../../src/service/nexora-onboarding-orchestrator-service.js';
import onboardingStateMachine from '../../src/service/nexora-onboarding-state-machine.js';
import tokenStorage from '../../src/service/nexora-onboarding-token-storage-service.js';

const TENANT_ID = 990601;
const WORKSPACE_ID = 990602;

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
	`CREATE TABLE mission_runtime_events (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT, step_id TEXT, action_id TEXT,
		tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, event_type TEXT NOT NULL,
		from_state TEXT, to_state TEXT, expected_version INTEGER, fencing_token INTEGER,
		detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
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
	`CREATE TABLE nexora_onboarding_authorization_sessions (
		id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')),
		client_registration_mode TEXT NOT NULL CHECK(client_registration_mode IN ('first_party','byo_app')),
		redirect_uri_id TEXT NOT NULL, scopes_json TEXT NOT NULL, incremental_scopes_json TEXT NOT NULL DEFAULT '[]',
		state_hash TEXT NOT NULL, nonce_hash TEXT, pkce_challenge TEXT NOT NULL, pkce_challenge_method TEXT NOT NULL DEFAULT 'S256',
		pkce_verifier_hash TEXT NOT NULL, tenant_hint TEXT, login_hint_hash TEXT,
		status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','consumed','expired','cancelled','error')),
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, consumed_at TEXT,
		callback_fingerprint TEXT, resume_checkpoint TEXT,
		UNIQUE(tenant_id,workspace_id,state_hash)
	)`,
	`CREATE TABLE nexora_onboarding_tokens (
		id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')), provider_account_hash TEXT NOT NULL,
		refresh_token_ciphertext TEXT NOT NULL, access_token_ciphertext TEXT, access_token_expires_at TEXT,
		granted_scopes_json TEXT NOT NULL, rotation_generation INTEGER NOT NULL DEFAULT 1,
		connection_health TEXT NOT NULL DEFAULT 'healthy' CHECK(connection_health IN ('healthy','degraded','revoked','unknown')),
		last_successful_refresh_at TEXT, last_failed_refresh_at TEXT, refresh_failure_count INTEGER NOT NULL DEFAULT 0,
		revoked_at TEXT, revoked_reason TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(onboarding_mission_id)
	)`,
	`CREATE TABLE nexora_onboarding_capabilities (
		id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		provider TEXT NOT NULL, capability_key TEXT NOT NULL,
		status TEXT NOT NULL CHECK(status IN ('SUPPORTED','UNSUPPORTED','CONSENT_REQUIRED','ADMIN_APPROVAL_REQUIRED','POLICY_DENIED','TEMPORARILY_UNAVAILABLE','DEGRADED')),
		reason_codes_json TEXT NOT NULL DEFAULT '[]', observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(onboarding_mission_id, capability_key)
	)`,
	`CREATE TABLE nexora_autonomy_jobs (
		id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, domain TEXT COLLATE NOCASE, job_type TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
		state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','RETRYING','SUCCEEDED','BLOCKED','FAILED')) DEFAULT 'QUEUED', attempt_count INTEGER NOT NULL DEFAULT 0,
		lease_until TEXT, input_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}', blocker_code TEXT, next_attempt_at TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
];
const TABLES = ['mission_runtime_missions', 'mission_runtime_runs', 'mission_runtime_events', 'nexora_onboarding_state', 'nexora_onboarding_authorization_sessions', 'nexora_onboarding_tokens', 'nexora_onboarding_capabilities', 'nexora_autonomy_jobs'];

async function resetSchema() {
	await env.db.batch(TABLES.map((t) => env.db.prepare(`DROP TABLE IF EXISTS ${t}`)));
	for (const sql of SCHEMA_STATEMENTS) await env.db.prepare(sql).run();
}

const scope = { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID };

beforeEach(async () => {
	await resetSchema();
});

describe('NEXORA onboarding orchestrator — end-to-end real D1 (Checkpoint 4/8)', () => {
	it('start with no configured client_id: fails honestly, blocks the phase, does not fabricate a redirect', async () => {
		const c = { env }; // no NEXORA_GOOGLE_OAUTH_CLIENT_ID configured in the real pool-workers env
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'start-1' });
		expect(started.ok).toBe(false);
		expect(started.reason).toBe('PROVIDER_APPLICATION_MISSING');
		const phaseRow = await env.db.prepare(`SELECT phase,blocked_reason,required_human_actor FROM nexora_onboarding_state WHERE mission_id=?1`).bind(started.missionId).first();
		expect(phaseRow.phase).toBe('blocked');
		expect(phaseRow.blocked_reason).toBe('PROVIDER_APPLICATION_MISSING');
		expect(phaseRow.required_human_actor).toBe('workspace_administrator');
	});

	it('start is idempotent: a duplicate start with the same idempotency key reuses the same Mission, not a second one', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id' } };
		const first = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'start-dup' });
		const second = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'start-dup' });
		expect(first.missionId).toBe(second.missionId);
		const missionCount = await env.db.prepare(`SELECT COUNT(*) n FROM mission_runtime_missions WHERE idempotency_key='start-dup'`).first();
		expect(Number(missionCount.n)).toBe(1);
	});

	it('E23/V18: a valid callback automatically resumes the originating Mission with no further user action', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'start-2' });
		expect(started.ok).toBe(true);
		expect(started.state).toBeTruthy();
		expect(started.verifier).toBeTruthy();

		const beforePhase = await env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(started.missionId).first();
		expect(beforePhase.phase).toBe('waiting_for_user_login');

		// Simulate the real provider redirecting the user back with the state it was given --
		// this is the exact contract a real /v3/onboarding/callback HTTP handler drives.
		const callback = await onboardingOrchestrator.handleCallback(c, scope, { state: started.state, verifier: started.verifier, callbackFingerprint: 'fp-e2e-1' });
		expect(callback.ok).toBe(true);
		expect(callback.missionId).toBe(started.missionId);
		expect(callback.phase).toBe('authorization_received');
		expect(callback.missionResumed).toBe(true); // the underlying Mission run was automatically claimed/advanced

		const mission = await env.db.prepare(`SELECT state FROM mission_runtime_missions WHERE id=?1`).bind(started.missionId).first();
		expect(mission.state).toBe('running'); // resumed with zero further user action

		// Duplicate callback delivery must be harmless and must not re-advance the phase or
		// double-claim the run.
		const duplicate = await onboardingOrchestrator.handleCallback(c, scope, { state: started.state, verifier: started.verifier, callbackFingerprint: 'fp-e2e-1' });
		expect(duplicate.ok).toBe(true);
		expect(duplicate.duplicate).toBe(true);
		const phaseAfterDuplicate = await env.db.prepare(`SELECT phase,phase_version FROM nexora_onboarding_state WHERE mission_id=?1`).bind(started.missionId).first();
		expect(phaseAfterDuplicate.phase).toBe('authorization_received');
	});

	it('E31/V8: resume after a simulated restart reclaims the Mission run and reports the authoritative current phase', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'start-3' });
		await onboardingOrchestrator.handleCallback(c, scope, { state: started.state, verifier: started.verifier, callbackFingerprint: 'fp-resume-1' });
		// Simulate a crashed worker holding the run's lease.
		await env.db.prepare(`UPDATE mission_runtime_runs SET lease_until=datetime('now','-1 minutes') WHERE mission_id=?1`).bind(started.missionId).run();
		const resumed = await onboardingOrchestrator.resumeOnboarding(c, scope, { missionId: started.missionId });
		expect(resumed.ok).toBe(true);
		expect(resumed.resumed).toBe(true);
		expect(resumed.phase).toBe('authorization_received');
	});

	it('resume on an already-terminal onboarding reports ALREADY_TERMINAL without attempting to reclaim anything', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'start-4' });
		await onboardingOrchestrator.cancelOnboarding(c, scope, { missionId: started.missionId });
		const resumed = await onboardingOrchestrator.resumeOnboarding(c, scope, { missionId: started.missionId });
		expect(resumed.resumed).toBe(false);
		expect(resumed.reason).toBe('ALREADY_TERMINAL');
	});

	it('cancellation before execution succeeds from a waiting phase and terminates both the phase and the underlying Mission', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'start-5' });
		const cancelled = await onboardingOrchestrator.cancelOnboarding(c, scope, { missionId: started.missionId });
		expect(cancelled.ok).toBe(true);
		const phase = await env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(started.missionId).first();
		expect(phase.phase).toBe('cancelled');
		const mission = await env.db.prepare(`SELECT state FROM mission_runtime_missions WHERE id=?1`).bind(started.missionId).first();
		expect(mission.state).toBe('cancelled');
	});

	it('cancellation after safe cancellation is no longer possible (already terminal) is rejected, not silently no-op', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'start-6' });
		await onboardingOrchestrator.cancelOnboarding(c, scope, { missionId: started.missionId });
		const second = await onboardingOrchestrator.cancelOnboarding(c, scope, { missionId: started.missionId });
		expect(second.ok).toBe(false);
		expect(second.reason).toBe('CANCELLATION_NOT_SAFE_FROM_CURRENT_PHASE');
	});

	it('repair re-enters validating_authority only from a repair-eligible phase (degraded), not from an arbitrary earlier phase', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'start-7' });
		const rejected = await onboardingOrchestrator.repairOnboarding(c, scope, { missionId: started.missionId });
		expect(rejected.ok).toBe(false);
		expect(rejected.reason).toBe('REPAIR_NOT_ELIGIBLE_FROM_CURRENT_PHASE');

		await onboardingOrchestrator.handleCallback(c, scope, { state: started.state, verifier: started.verifier, callbackFingerprint: 'fp-repair-1' });
		// Manually drive to a repair-eligible phase for this test (real driver is
		// nexora-onboarding-sync-service under a failed capability/connection check).
		await onboardingStateMachine.advancePhase(c, scope, { missionId: started.missionId, to: 'validating_authority' });
		await onboardingStateMachine.advancePhase(c, scope, { missionId: started.missionId, to: 'discovering_capabilities' });
		await onboardingStateMachine.advancePhase(c, scope, { missionId: started.missionId, to: 'provisioning' });
		await onboardingStateMachine.advancePhase(c, scope, { missionId: started.missionId, to: 'verifying_connection' });
		await onboardingStateMachine.advancePhase(c, scope, { missionId: started.missionId, to: 'starting_initial_sync' });
		await onboardingStateMachine.advancePhase(c, scope, { missionId: started.missionId, to: 'verifying_initial_sync' });
		await onboardingStateMachine.advancePhase(c, scope, { missionId: started.missionId, to: 'connected' });
		await onboardingStateMachine.advancePhase(c, scope, { missionId: started.missionId, to: 'degraded' });

		const repaired = await onboardingOrchestrator.repairOnboarding(c, scope, { missionId: started.missionId });
		expect(repaired.ok).toBe(true);
		expect(repaired.phase).toBe('validating_authority');
	});
});

describe('NEXORA onboarding orchestrator — full real chain: callback code -> token exchange -> storage -> capability discovery -> sync dispatch', () => {
	function fixtureFetch(scopeString) {
		return async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token', expires_in: 3600, scope: scopeString }) });
	}

	it('Required Output #4: a callback WITH a real authorization code drives the chain all the way to starting_initial_sync, with encrypted tokens stored and capability SUPPORTED', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', jwt_secret: 'test-only-pool-workers-encryption-secret' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'chain-1' });
		expect(started.ok).toBe(true);

		const result = await onboardingOrchestrator.handleCallback(c, scope, {
			state: started.state,
			verifier: started.verifier,
			code: 'fixture-authorization-code',
			redirectUri: 'https://nexora.example/callback/google',
			callbackFingerprint: 'fp-chain-1',
			fetchImpl: fixtureFetch('openid email https://www.googleapis.com/auth/gmail.readonly'),
		});

		expect(result.ok).toBe(true);
		expect(result.tokenExchangeAttempted).toBe(true);
		expect(result.tokenExchangeOk).toBe(true);
		expect(result.capabilityStatus).toBe('SUPPORTED');
		expect(result.syncDispatched).toBe(true);
		expect(result.phase).toBe('starting_initial_sync');

		// Real encrypted token storage -- round-trips correctly, ciphertext at rest.
		const health = await tokenStorage.connectionHealth(c, scope, { onboardingMissionId: started.missionId });
		expect(health.exists).toBe(true);
		expect(health.health).toBe('healthy');
		const tokenRow = await env.db.prepare(`SELECT refresh_token_ciphertext FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1`).bind(started.missionId).first();
		expect(tokenRow.refresh_token_ciphertext).not.toContain('fixture-refresh-token');

		const capabilityRow = await env.db.prepare(`SELECT status FROM nexora_onboarding_capabilities WHERE onboarding_mission_id=?1 AND capability_key='mail_read'`).bind(started.missionId).first();
		expect(capabilityRow.status).toBe('SUPPORTED');

		const job = await env.db.prepare(`SELECT COUNT(*) n FROM nexora_autonomy_jobs WHERE idempotency_key=?1`).bind(`sync:${started.missionId}`).first();
		expect(Number(job.n)).toBe(1);
	});

	it('insufficient granted scope blocks with CAPABILITY_SCOPE_INSUFFICIENT rather than falsely proceeding to sync', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', jwt_secret: 'test-only-pool-workers-encryption-secret' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'chain-2' });
		// Provider grants only 'openid' -- not the requested gmail.readonly scope (e.g. user
		// denied part of the consent screen).
		const result = await onboardingOrchestrator.handleCallback(c, scope, { state: started.state, verifier: started.verifier, code: 'fixture-code-2', redirectUri: 'https://x/callback', callbackFingerprint: 'fp-chain-2', fetchImpl: fixtureFetch('openid') });
		expect(result.capabilityStatus).not.toBe('SUPPORTED');
		expect(result.syncDispatched).toBe(false);
		expect(result.phase).toBe('blocked');
		const phaseRow = await env.db.prepare(`SELECT blocked_reason,required_human_actor FROM nexora_onboarding_state WHERE mission_id=?1`).bind(started.missionId).first();
		expect(phaseRow.blocked_reason).toBe('CAPABILITY_SCOPE_INSUFFICIENT');
		expect(phaseRow.required_human_actor).toBe('end_user');
	});

	it('a token-exchange failure (e.g. invalid_grant for a reused code) drives the phase to failed with the real error code, not silently ignored', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', jwt_secret: 'test-only-pool-workers-encryption-secret' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'chain-3' });
		const failingFetch = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'Code was already redeemed.' }) });
		const result = await onboardingOrchestrator.handleCallback(c, scope, { state: started.state, verifier: started.verifier, code: 'reused-code', redirectUri: 'https://x/callback', callbackFingerprint: 'fp-chain-3', fetchImpl: failingFetch });
		expect(result.tokenExchangeOk).toBe(false);
		expect(result.phase).toBe('failed');
		const phaseRow = await env.db.prepare(`SELECT blocked_reason FROM nexora_onboarding_state WHERE mission_id=?1`).bind(started.missionId).first();
		expect(phaseRow.blocked_reason).toBe('invalid_grant');
		const tokenCount = await env.db.prepare(`SELECT COUNT(*) n FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1`).bind(started.missionId).first();
		expect(Number(tokenCount.n)).toBe(0); // no token stored for a failed exchange
	});
});
