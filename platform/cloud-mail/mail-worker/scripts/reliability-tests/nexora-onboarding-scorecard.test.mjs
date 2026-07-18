// NEXORA Zero-Touch onboarding: scorecard computed from a real onboarding run's own recorded
// evidence (mission_runtime_events), not fabricated/hardcoded numbers.
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import onboardingOrchestrator from '../../src/service/nexora-onboarding-orchestrator-service.js';
import scorecardService, { ORDINARY_USER_TECHNICAL_FIELDS_REQUIRED } from '../../src/service/nexora-onboarding-scorecard-service.js';

const TENANT_ID = 991001;
const WORKSPACE_ID = 991002;

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

describe('Zero-Touch scorecard — computed from a real onboarding run', () => {
	it('reports zero ordinary-user technical fields by construction, and real timing/counters from an actual run', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'scorecard-1' });
		await onboardingOrchestrator.handleCallback(c, scope, { state: started.state, verifier: started.verifier, callbackFingerprint: 'fp-sc-1' });

		const scorecard = await scorecardService.computeScorecard(c, scope, { missionId: started.missionId });
		expect(scorecard.ordinary_user_technical_fields_required).toBe(ORDINARY_USER_TECHNICAL_FIELDS_REQUIRED);
		expect(scorecard.ordinary_user_technical_fields_required).toBe(0);
		expect(scorecard.manual_provider_configuration_steps).toBe(0);
		expect(scorecard.provider_required_login_interactions).toBe(1);
		expect(scorecard.provider_required_consent_interactions).toBe(1);
		expect(scorecard.administrator_bootstrap_interactions).toBe(0); // this run had a configured client_id -- no admin blocker occurred
		expect(scorecard.failed_events).toBe(0);
		expect(scorecard.cancelled_before_completion).toBe(false);
		expect(typeof scorecard.time_to_authorization_seconds).toBe('number');
		expect(scorecard.time_to_authorization_seconds).toBeGreaterThanOrEqual(0);
	});

	it('a run blocked on a missing provider application records exactly one administrator_bootstrap_interaction', async () => {
		const c = { env }; // no client_id configured
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'scorecard-2' });
		expect(started.ok).toBe(false);
		const scorecard = await scorecardService.computeScorecard(c, scope, { missionId: started.missionId });
		expect(scorecard.administrator_bootstrap_interactions).toBe(1);
		expect(scorecard.blocked_events).toBe(1);
		expect(scorecard.time_to_verified_provider_connection_seconds).toBeNull(); // never reached connected
	});
});
