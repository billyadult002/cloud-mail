// NEXORA Zero-Touch onboarding orchestrator: end-to-end real-D1 test of startOnboarding ->
// (real provider consent, simulated) -> handleCallback -> automatic Mission continuation.
// This is the Checkpoint 4/8 "automatic Mission continuation" evidence: no user action is
// required between a valid callback and the underlying Mission resuming.
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import onboardingOrchestrator from '../../src/service/nexora-onboarding-orchestrator-service.js';

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
];
const TABLES = ['mission_runtime_missions', 'mission_runtime_runs', 'mission_runtime_events', 'nexora_onboarding_state', 'nexora_onboarding_authorization_sessions'];

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
});
