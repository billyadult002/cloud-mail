// NEXORA Zero-Touch onboarding orchestrator: end-to-end real-D1 test of startOnboarding ->
// (real provider consent, simulated) -> handleCallback -> automatic Mission continuation.
// This is the Checkpoint 4/8 "automatic Mission continuation" evidence: no user action is
// required between a valid callback and the underlying Mission resuming.
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../../src/hono/webs.js';
import worker from '../../src/index.js';
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
		completed_at TEXT, checkpoint_id TEXT, continuation_idempotency_key TEXT, UNIQUE(tenant_id,workspace_id,idempotency_key)
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
	`CREATE TABLE nexora_onboarding_callback_correlations (
		id TEXT PRIMARY KEY, state_hash TEXT NOT NULL UNIQUE, authorization_session_id TEXT NOT NULL UNIQUE,
		onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, provider TEXT NOT NULL,
		redirect_uri_id TEXT NOT NULL, redirect_uri_hash TEXT NOT NULL, requested_scopes_json TEXT NOT NULL, requested_capabilities_json TEXT NOT NULL DEFAULT '[]', scope_plan_reference TEXT, pkce_challenge TEXT NOT NULL, pkce_challenge_reference TEXT NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending', claim_token TEXT, claimed_at TEXT, claimed_by TEXT, claim_expires_at TEXT, claim_generation INTEGER NOT NULL DEFAULT 0,
		callback_fingerprint TEXT, resume_checkpoint TEXT, evidence_references_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, expires_at TEXT NOT NULL, consumed_at TEXT, cancelled_at TEXT
	)`,
	`CREATE TABLE nexora_onboarding_callback_claims (id TEXT PRIMARY KEY, correlation_id TEXT NOT NULL UNIQUE, authorization_session_id TEXT NOT NULL, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, provider TEXT NOT NULL, lease_owner TEXT, lease_acquired_at TEXT, lease_expires_at TEXT, fencing_token INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0, recovery_mode TEXT NOT NULL DEFAULT 'EXECUTION', claim_status TEXT NOT NULL DEFAULT 'AVAILABLE', last_heartbeat_at TEXT, takeover_count INTEGER NOT NULL DEFAULT 0, evidence_references_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE nexora_onboarding_callback_checkpoints (id TEXT PRIMARY KEY, correlation_id TEXT NOT NULL, claim_id TEXT NOT NULL, fencing_token INTEGER NOT NULL, step TEXT NOT NULL, status TEXT NOT NULL, attempt INTEGER NOT NULL DEFAULT 0, started_at TEXT, observed_at TEXT, persisted_at TEXT, completed_at TEXT, provider_operation_reference TEXT, token_generation_reference INTEGER, connection_reference TEXT, sync_job_reference TEXT, mission_checkpoint_reference TEXT, evidence_references_json TEXT NOT NULL DEFAULT '[]', last_error_code TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(correlation_id,step))`,
	`CREATE TABLE nexora_onboarding_reauthorization_work (id TEXT PRIMARY KEY, original_correlation_id TEXT NOT NULL UNIQUE, original_authorization_session_id TEXT NOT NULL, replacement_authorization_session_id TEXT UNIQUE, replacement_correlation_id TEXT UNIQUE, replacement_token_generation INTEGER, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, provider TEXT NOT NULL, requested_capabilities_json TEXT NOT NULL DEFAULT '[]', scope_plan_reference TEXT, reason_code TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE, expected_token_generation INTEGER, lease_owner TEXT, lease_acquired_at TEXT, lease_expires_at TEXT, fencing_token INTEGER NOT NULL DEFAULT 0, attempt INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'PENDING', evidence_references_json TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, completed_at TEXT)`,
	`CREATE TABLE nexora_onboarding_capabilities (
		id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
		provider TEXT NOT NULL, capability_key TEXT NOT NULL,
		status TEXT NOT NULL CHECK(status IN ('SUPPORTED','UNSUPPORTED','CONSENT_REQUIRED','ADMIN_APPROVAL_REQUIRED','POLICY_DENIED','TEMPORARILY_UNAVAILABLE','DEGRADED')),
		reason_codes_json TEXT NOT NULL DEFAULT '[]', observed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
		UNIQUE(onboarding_mission_id, capability_key)
	)`,
	`CREATE TABLE mission_runtime_evidence (id TEXT PRIMARY KEY,mission_id TEXT,run_id TEXT,step_id TEXT,action_id TEXT,tenant_id INTEGER,workspace_id INTEGER,claim_key TEXT,evidence_type TEXT,source_type TEXT,producer_type TEXT,producer_id_hash TEXT,reference_hash TEXT,summary_json TEXT,status TEXT,integrity_hash TEXT,observed_at TEXT,expires_at TEXT,created_at TEXT)`,
	`CREATE TABLE mission_runtime_evidence_relations (id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,evidence_id TEXT,related_evidence_id TEXT,relation_type TEXT)`,
	`CREATE TABLE mission_runtime_claims (id TEXT PRIMARY KEY,mission_id TEXT,run_id TEXT,tenant_id INTEGER,workspace_id INTEGER,claim_key TEXT,policy_id TEXT,policy_version INTEGER,version INTEGER)`,
	`CREATE TABLE mission_runtime_verification_policies (id TEXT,version INTEGER,required_evidence_json TEXT,freshness_seconds INTEGER,minimum_distinct_evidence INTEGER,conflict_mode TEXT,policy_hash TEXT)`,
	`CREATE TABLE mission_runtime_verifications (id TEXT PRIMARY KEY,mission_id TEXT,run_id TEXT,action_id TEXT,tenant_id INTEGER,workspace_id INTEGER,state TEXT,evidence_id TEXT,verifier TEXT,claim_id TEXT,policy_id TEXT,policy_version INTEGER,evidence_set_hash TEXT,reason_codes_json TEXT,integrity_state TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE mission_runtime_verification_evidence (verification_id TEXT,evidence_id TEXT,tenant_id INTEGER,workspace_id INTEGER,disposition TEXT,reason_code TEXT,evidence_integrity_hash TEXT)`,
	`CREATE TABLE nexora_onboarding_provider_connections (id TEXT PRIMARY KEY,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,connection_identity TEXT NOT NULL,generation INTEGER NOT NULL DEFAULT 1,connection_state TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(tenant_id,workspace_id,provider,connection_identity))`,
	`CREATE TABLE nexora_onboarding_token_connection_bindings (token_id TEXT PRIMARY KEY,connection_id TEXT NOT NULL UNIQUE,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,token_generation INTEGER NOT NULL,connection_generation INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE nexora_provider_outcome_results (id TEXT PRIMARY KEY,outcome_kind TEXT NOT NULL,operation_id TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,authority_tuple_digest TEXT NOT NULL,outcome_digest TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,connection_id TEXT,mission_id TEXT NOT NULL,authorization_session_id TEXT,correlation_id TEXT,refresh_job_id TEXT,lease_owner TEXT NOT NULL,fencing_token INTEGER NOT NULL,expected_token_generation INTEGER NOT NULL,committed_token_generation INTEGER NOT NULL,expected_provider_connection_generation INTEGER,committed_provider_connection_generation INTEGER,observation_reference TEXT,normalized_reason_code TEXT NOT NULL,retry_classification TEXT NOT NULL,outcome_status TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,committed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,evidence_outbox_id TEXT)`,
	`CREATE TABLE nexora_onboarding_evidence_outbox (id TEXT PRIMARY KEY,commit_result_id TEXT NOT NULL,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,event_type TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',canonical_evidence_reference TEXT,attempt_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,delivered_at TEXT)`,
	`CREATE TABLE nexora_onboarding_evidence_delivery_leases (outbox_id TEXT PRIMARY KEY,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,owner TEXT NOT NULL,fencing_token INTEGER NOT NULL,lease_expires_at TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE nexora_callback_verifier_authorizations (id TEXT PRIMARY KEY,verification_generation INTEGER NOT NULL,verifier_identity TEXT NOT NULL,authority_digest TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,mission_id TEXT NOT NULL,callback_correlation_id TEXT NOT NULL,expires_at TEXT NOT NULL,consumed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(tenant_id,workspace_id,mission_id,verification_generation))`,
	`CREATE TABLE nexora_callback_verification_attempts (id TEXT PRIMARY KEY,verification_policy_id TEXT NOT NULL,verification_generation INTEGER NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,evidence_set_digest TEXT NOT NULL,authority_tuple_digest TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,mission_id TEXT NOT NULL,callback_correlation_id TEXT NOT NULL,verifier_authorization_id TEXT NOT NULL,status TEXT NOT NULL,result_json TEXT NOT NULL DEFAULT '{}',failure_classification TEXT,canonical_evidence_refs_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,verified_at TEXT)`,
	`CREATE TABLE nexora_callback_verified_outcome_finalizations (id TEXT PRIMARY KEY,operation_id TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,authority_tuple_digest TEXT NOT NULL,evidence_set_digest TEXT NOT NULL,verification_attempt_id TEXT NOT NULL,verifier_authorization_id TEXT NOT NULL,verified_outcome_reference TEXT,callback_checkpoint_reference TEXT,expected_token_generation INTEGER NOT NULL,expected_provider_connection_generation INTEGER,state TEXT NOT NULL CHECK(state IN ('READY','FINALIZING','VERIFIED','BLOCKED','FAILED')),tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,mission_id TEXT NOT NULL,callback_correlation_id TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,finalized_at TEXT)`,
	`CREATE TABLE nexora_callback_verified_results (id TEXT PRIMARY KEY,finalization_operation_id TEXT NOT NULL,finalization_idempotency_key TEXT NOT NULL UNIQUE,verification_attempt_id TEXT NOT NULL UNIQUE,verifier_authorization_id TEXT NOT NULL UNIQUE,verification_policy_id TEXT NOT NULL,verification_generation INTEGER NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,mission_id TEXT NOT NULL,provider TEXT NOT NULL,authorization_session_id TEXT,callback_correlation_id TEXT NOT NULL,replacement_authorization_session_id TEXT,replacement_correlation_id TEXT,authority_tuple_digest TEXT NOT NULL,evidence_set_digest TEXT NOT NULL,atomic_callback_result_id TEXT NOT NULL,provider_outcome_result_id TEXT NOT NULL,token_generation INTEGER NOT NULL,provider_connection_id TEXT,provider_connection_generation INTEGER,canonical_evidence_references_json TEXT NOT NULL DEFAULT '[]',callback_outcome_verified_checkpoint_id TEXT NOT NULL,result_status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,verified_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(mission_id,callback_correlation_id,verification_generation))`,
	`CREATE TABLE nexora_reauthorization_completion_results (id TEXT PRIMARY KEY,reauthorization_work_id TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,authority_tuple_digest TEXT NOT NULL,evidence_set_digest TEXT NOT NULL,verified_result_id TEXT NOT NULL,finalization_id TEXT NOT NULL,verifier_authorization_id TEXT NOT NULL,verification_attempt_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,mission_id TEXT NOT NULL,provider TEXT NOT NULL,authorization_session_id TEXT NOT NULL,callback_correlation_id TEXT NOT NULL,replacement_authorization_session_id TEXT,replacement_correlation_id TEXT,token_generation INTEGER NOT NULL,provider_connection_id TEXT NOT NULL,provider_connection_generation INTEGER NOT NULL,lease_owner TEXT NOT NULL,fencing_token INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(reauthorization_work_id),UNIQUE(verified_result_id))`,
	`CREATE TABLE nexora_callback_correlation_consumption_results (id TEXT PRIMARY KEY,correlation_id TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,mission_continuation_id TEXT NOT NULL UNIQUE,reauthorization_completion_id TEXT,verified_result_id TEXT NOT NULL,finalization_id TEXT NOT NULL,verifier_authorization_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,mission_id TEXT NOT NULL,provider TEXT NOT NULL,authorization_session_id TEXT NOT NULL,replacement_authorization_session_id TEXT,replacement_correlation_id TEXT,token_generation INTEGER NOT NULL,provider_connection_id TEXT NOT NULL,provider_connection_generation INTEGER NOT NULL,lease_owner TEXT NOT NULL,fencing_token INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,consumed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(correlation_id))`,
	`CREATE TABLE nexora_mission_continuation_results (id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,correlation_consumption_id TEXT NOT NULL UNIQUE,verified_result_id TEXT NOT NULL,mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,resume_checkpoint TEXT NOT NULL,token_generation INTEGER NOT NULL,provider_connection_id TEXT NOT NULL,provider_connection_generation INTEGER NOT NULL,lease_owner TEXT NOT NULL,fencing_token INTEGER NOT NULL,sync_intent_id TEXT,sync_dispatch_id TEXT,sync_job_id TEXT,notification_id TEXT,status TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,continued_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(mission_id))`,
	`CREATE TABLE nexora_initial_sync_intents (id TEXT PRIMARY KEY,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,mission_id TEXT NOT NULL,callback_correlation_id TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE nexora_initial_sync_dispatches (id TEXT PRIMARY KEY,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,mission_id TEXT NOT NULL,intent_id TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE nexora_onboarding_notifications (id TEXT PRIMARY KEY,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,mission_id TEXT NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE nexora_autonomy_jobs (
		id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, domain TEXT COLLATE NOCASE, job_type TEXT NOT NULL, idempotency_key TEXT NOT NULL UNIQUE,
		state TEXT NOT NULL CHECK(state IN ('QUEUED','RUNNING','RETRYING','SUCCEEDED','BLOCKED','FAILED')) DEFAULT 'QUEUED', attempt_count INTEGER NOT NULL DEFAULT 0,
		lease_until TEXT, input_json TEXT NOT NULL DEFAULT '{}', result_json TEXT NOT NULL DEFAULT '{}', blocker_code TEXT, next_attempt_at TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
];
const TABLES = ['mission_runtime_missions', 'mission_runtime_runs', 'mission_runtime_events', 'mission_runtime_evidence', 'mission_runtime_evidence_relations', 'mission_runtime_claims', 'mission_runtime_verification_policies', 'mission_runtime_verifications', 'mission_runtime_verification_evidence', 'nexora_onboarding_state', 'nexora_onboarding_reauthorization_work', 'nexora_onboarding_callback_checkpoints', 'nexora_onboarding_callback_claims', 'nexora_onboarding_callback_correlations', 'nexora_onboarding_authorization_sessions', 'nexora_onboarding_tokens', 'nexora_onboarding_capabilities', 'nexora_onboarding_provider_connections', 'nexora_onboarding_token_connection_bindings', 'nexora_provider_outcome_results', 'nexora_onboarding_evidence_outbox', 'nexora_onboarding_evidence_delivery_leases', 'nexora_callback_verifier_authorizations', 'nexora_callback_verification_attempts', 'nexora_callback_verified_outcome_finalizations', 'nexora_callback_verified_results', 'nexora_reauthorization_completion_results', 'nexora_callback_correlation_consumption_results', 'nexora_mission_continuation_results', 'nexora_initial_sync_intents', 'nexora_initial_sync_dispatches', 'nexora_onboarding_notifications', 'nexora_autonomy_jobs'];

async function resetSchema() {
	await env.db.batch(TABLES.map((t) => env.db.prepare(`DROP TABLE IF EXISTS ${t}`)));
	for (const sql of SCHEMA_STATEMENTS) await env.db.prepare(sql).run();
}

const scope = { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID };
const GOOGLE_REDIRECT_URI = 'https://nexora.example/v3/onboarding/providers/google/callback';
const MICROSOFT_REDIRECT_URI = 'https://nexora.example/v3/onboarding/providers/microsoft/callback';

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
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', NEXORA_GOOGLE_OAUTH_REDIRECT_URI: GOOGLE_REDIRECT_URI } };
		const first = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'start-dup' });
		const second = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'start-dup' });
		expect(first.missionId).toBe(second.missionId);
		const missionCount = await env.db.prepare(`SELECT COUNT(*) n FROM mission_runtime_missions WHERE idempotency_key='start-dup'`).first();
		expect(Number(missionCount.n)).toBe(1);
	});

	it('E23/V18: a valid callback automatically resumes the originating Mission with no further user action', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', NEXORA_GOOGLE_OAUTH_REDIRECT_URI: GOOGLE_REDIRECT_URI } };
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
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', NEXORA_GOOGLE_OAUTH_REDIRECT_URI: GOOGLE_REDIRECT_URI } };
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
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', NEXORA_GOOGLE_OAUTH_REDIRECT_URI: GOOGLE_REDIRECT_URI } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'start-4' });
		await onboardingOrchestrator.cancelOnboarding(c, scope, { missionId: started.missionId });
		const resumed = await onboardingOrchestrator.resumeOnboarding(c, scope, { missionId: started.missionId });
		expect(resumed.resumed).toBe(false);
		expect(resumed.reason).toBe('ALREADY_TERMINAL');
	});

	it('cancellation before execution succeeds from a waiting phase and terminates both the phase and the underlying Mission', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', NEXORA_GOOGLE_OAUTH_REDIRECT_URI: GOOGLE_REDIRECT_URI } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'start-5' });
		const cancelled = await onboardingOrchestrator.cancelOnboarding(c, scope, { missionId: started.missionId });
		expect(cancelled.ok).toBe(true);
		const phase = await env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(started.missionId).first();
		expect(phase.phase).toBe('cancelled');
		const mission = await env.db.prepare(`SELECT state FROM mission_runtime_missions WHERE id=?1`).bind(started.missionId).first();
		expect(mission.state).toBe('cancelled');
	});

	it('cancellation after safe cancellation is no longer possible (already terminal) is rejected, not silently no-op', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', NEXORA_GOOGLE_OAUTH_REDIRECT_URI: GOOGLE_REDIRECT_URI } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'start-6' });
		await onboardingOrchestrator.cancelOnboarding(c, scope, { missionId: started.missionId });
		const second = await onboardingOrchestrator.cancelOnboarding(c, scope, { missionId: started.missionId });
		expect(second.ok).toBe(false);
		expect(second.reason).toBe('CANCELLATION_NOT_SAFE_FROM_CURRENT_PHASE');
	});

	it('repair re-enters validating_authority only from a repair-eligible phase (degraded), not from an arbitrary earlier phase', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', NEXORA_GOOGLE_OAUTH_REDIRECT_URI: GOOGLE_REDIRECT_URI } };
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
	const keyFixture = crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
	function b64urlBytes(bytes) {
		return btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	}
	function b64urlJson(obj) {
		return b64urlBytes(new TextEncoder().encode(JSON.stringify(obj)));
	}
	async function fixtureIdToken(claims, { kid = 'fixture-kid-1', clientId = 'test-client-id', issuer = 'https://accounts.google.com' } = {}) {
		const keys = await keyFixture;
		const header = b64urlJson({ alg: 'RS256', typ: 'JWT', kid });
		const payload = b64urlJson({ iss: issuer, aud: clientId, exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
		const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${header}.${payload}`));
		return `${header}.${payload}.${b64urlBytes(signature)}`;
	}
	async function fixtureJwks() {
		const keys = await keyFixture;
		return { keys: [{ ...(await crypto.subtle.exportKey('jwk', keys.publicKey)), kid: 'fixture-kid-1', alg: 'RS256', use: 'sig' }] };
	}
	function jwksFetch() {
		return async () => ({ ok: true, status: 200, json: fixtureJwks });
	}
	function fixtureFetch(scopeString, idTokenClaims = { sub: 'fixture-subject-1', email: 'user@example.com' }, idTokenOptions = {}) {
		return async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token', expires_in: 3600, scope: scopeString, id_token: await fixtureIdToken(idTokenClaims, idTokenOptions) }) });
	}

	it('real Google provider GET callback route is public but state+PKCE+D1-authorized and completes the exact-once chain', async () => {
		const callbackFetch = Symbol.for('nexora.internal.providerCallbackFetch');
		const callbackJwksFetch = Symbol.for('nexora.internal.providerCallbackJwksFetch');
		const routeEnv = {
			...env,
			NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id',
			NEXORA_GOOGLE_OAUTH_REDIRECT_URI: GOOGLE_REDIRECT_URI,
			jwt_secret: 'test-only-pool-workers-encryption-secret',
			[callbackFetch]: fixtureFetch('openid email https://www.googleapis.com/auth/gmail.readonly', { sub: 'route-subject-1', email: 'route-user@example.com' }),
			[callbackJwksFetch]: jwksFetch(),
		};
		const started = await onboardingOrchestrator.startOnboarding({ env: routeEnv }, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'route-chain-1' });
		routeEnv[callbackFetch] = fixtureFetch('openid email https://www.googleapis.com/auth/gmail.readonly', { sub: 'route-subject-1', email: 'route-user@example.com', nonce: started.nonce });

		const res = await app.request(`/v3/onboarding/providers/google/callback?state=${encodeURIComponent(started.state)}&code=route-code-1`, {
			method: 'GET',
			headers: { Cookie: `nexora_pkce_verifier=${encodeURIComponent(started.verifier)}` },
		}, routeEnv);
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(body.code).toBe(200);
		expect(body.data.ok).toBe(true);
		expect(body.data.provider).toBe('google');
		expect(body.data.phase).toBe('starting_initial_sync');
		expect(body.data.syncDispatched).toBe(true);

		const chain = await env.db.prepare(`
			SELECT
				(SELECT COUNT(*) FROM nexora_provider_outcome_results WHERE mission_id=?1 AND provider='google') AS provider_outcomes,
				(SELECT COUNT(*) FROM nexora_callback_verified_results WHERE mission_id=?1 AND provider='google' AND result_status='VERIFIED') AS verified_results,
				(SELECT COUNT(*) FROM nexora_onboarding_callback_checkpoints WHERE correlation_id=(SELECT id FROM nexora_onboarding_callback_correlations WHERE onboarding_mission_id=?1) AND step='CALLBACK_OUTCOME_VERIFIED' AND status='VERIFIED') AS verified_checkpoints,
				(SELECT COUNT(*) FROM nexora_callback_correlation_consumption_results WHERE mission_id=?1 AND provider='google' AND status='CONSUMED') AS consumed_correlations,
				(SELECT COUNT(*) FROM nexora_mission_continuation_results WHERE mission_id=?1 AND provider='google' AND status='CONTINUED') AS continuations,
				(SELECT COUNT(*) FROM nexora_initial_sync_intents WHERE mission_id=?1 AND state='READY') AS sync_intents,
				(SELECT COUNT(*) FROM nexora_initial_sync_dispatches WHERE mission_id=?1 AND state='NOT_DISPATCHED') AS sync_dispatches,
				(SELECT COUNT(*) FROM nexora_autonomy_jobs WHERE job_type='ZERO_TOUCH_INITIAL_SYNC' AND state='QUEUED') AS sync_jobs
		`).bind(started.missionId).first();
		expect(Object.fromEntries(Object.entries(chain).map(([key, value]) => [key, Number(value)]))).toMatchObject({
			provider_outcomes: 1,
			verified_results: 1,
			verified_checkpoints: 1,
			consumed_correlations: 1,
			continuations: 1,
			sync_intents: 1,
			sync_dispatches: 1,
			sync_jobs: 1,
		});
	});

	it('production Worker entry routes provider-registered /v3 callbacks to Hono instead of the SPA fallback', async () => {
		const callbackFetch = Symbol.for('nexora.internal.providerCallbackFetch');
		const callbackJwksFetch = Symbol.for('nexora.internal.providerCallbackJwksFetch');
		const routeEnv = {
			...env,
			NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id',
			NEXORA_GOOGLE_OAUTH_REDIRECT_URI: GOOGLE_REDIRECT_URI,
			jwt_secret: 'test-only-pool-workers-encryption-secret',
			[callbackFetch]: fixtureFetch('openid email https://www.googleapis.com/auth/gmail.readonly', { sub: 'entry-subject-1', email: 'entry-user@example.com' }),
			[callbackJwksFetch]: jwksFetch(),
		};
		const started = await onboardingOrchestrator.startOnboarding({ env: routeEnv }, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'entry-route-chain-1' });
		routeEnv[callbackFetch] = fixtureFetch('openid email https://www.googleapis.com/auth/gmail.readonly', { sub: 'entry-subject-1', email: 'entry-user@example.com', nonce: started.nonce });

		const res = await worker.fetch(new Request(`https://cloud-mail.fastonegroup.workers.dev/v3/onboarding/providers/google/callback?state=${encodeURIComponent(started.state)}&code=entry-route-code-1`, {
			method: 'GET',
			headers: { Cookie: `nexora_pkce_verifier=${encodeURIComponent(started.verifier)}` },
		}), routeEnv, {});
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toContain('application/json');
		const body = await res.json();
		expect(body.data.ok).toBe(true);
		expect(body.data.provider).toBe('google');
		expect(body.data.syncDispatched).toBe(true);
	});

	it('Microsoft callback exchange uses the durable tenant hint selected when the authorization session was created', async () => {
		const c = { env: { ...env, NEXORA_MICROSOFT_OAUTH_CLIENT_ID: 'test-ms-client-id', NEXORA_MICROSOFT_OAUTH_REDIRECT_URI: MICROSOFT_REDIRECT_URI, jwt_secret: 'test-only-pool-workers-encryption-secret' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'microsoft', capabilities: ['mail_read'], idempotencyKey: 'chain-tenant-hint', tenantHint: 'contoso-tenant' });
		let observedUrl = null;
		const fetchImpl = async (url) => {
			observedUrl = String(url);
			return { ok: true, status: 200, json: async () => ({ access_token: 'fixture-at', refresh_token: 'fixture-rt', expires_in: 3600, scope: 'openid profile email Mail.Read', id_token: await fixtureIdToken({ sub: 'fixture-subject-ms', email: 'user@example.com', tid: 'contoso-tenant' }, { clientId: 'test-ms-client-id', issuer: 'https://login.microsoftonline.com/contoso-tenant/v2.0' }) }) };
		};

		const result = await onboardingOrchestrator.handleCallback(c, scope, { state: started.state, verifier: started.verifier, code: 'fixture-ms-code', redirectUri: MICROSOFT_REDIRECT_URI, callbackFingerprint: 'fp-ms-tenant-hint', allowedMicrosoftTenantIds: ['contoso-tenant'], fetchImpl, jwksFetchImpl: jwksFetch() });

		expect(result.tokenExchangeOk).toBe(true);
		expect(observedUrl).toContain('login.microsoftonline.com/contoso-tenant/oauth2/v2.0/token');
	});

	it('Microsoft admin-consent checkpoint uses the durable tenant hint and not the generic /common authority', async () => {
		const c = { env: { ...env, NEXORA_MICROSOFT_OAUTH_CLIENT_ID: 'test-ms-client-id', NEXORA_MICROSOFT_OAUTH_REDIRECT_URI: MICROSOFT_REDIRECT_URI, jwt_secret: 'test-only-pool-workers-encryption-secret' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'microsoft', capabilities: ['mail_read'], idempotencyKey: 'chain-admin-consent-tenant', tenantHint: 'admin-tenant' });
		const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: 'admin_consent_required', error_description: 'Tenant policy requires administrator consent.' }) });

		const result = await onboardingOrchestrator.handleCallback(c, scope, { state: started.state, verifier: started.verifier, code: 'fixture-ms-admin-code', redirectUri: MICROSOFT_REDIRECT_URI, callbackFingerprint: 'fp-ms-admin-tenant', fetchImpl });

		expect(result.capabilityStatus).toBe('ADMIN_APPROVAL_REQUIRED');
		expect(result.phase).toBe('waiting_for_admin_consent');
		const phaseRow = await env.db.prepare(`SELECT resume_token,required_human_actor FROM nexora_onboarding_state WHERE mission_id=?1`).bind(started.missionId).first();
		expect(phaseRow.required_human_actor).toBe('tenant_administrator');
		expect(phaseRow.resume_token).toContain('login.microsoftonline.com/admin-tenant/adminconsent');
		expect(phaseRow.resume_token).not.toContain('login.microsoftonline.com/common/adminconsent');
	});

	it('Required Output #4: a callback WITH a real authorization code drives the chain all the way to starting_initial_sync, with encrypted tokens stored and capability SUPPORTED', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', NEXORA_GOOGLE_OAUTH_REDIRECT_URI: GOOGLE_REDIRECT_URI, jwt_secret: 'test-only-pool-workers-encryption-secret' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'chain-1' });
		expect(started.ok).toBe(true);

		const result = await onboardingOrchestrator.handleCallback(c, scope, {
			state: started.state,
			verifier: started.verifier,
			code: 'fixture-authorization-code',
			redirectUri: 'https://nexora.example/callback/google',
			callbackFingerprint: 'fp-chain-1',
			fetchImpl: fixtureFetch('openid email https://www.googleapis.com/auth/gmail.readonly', { sub: 'fixture-subject-1', email: 'user@example.com', nonce: started.nonce }),
			jwksFetchImpl: jwksFetch(),
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

		const chain = await env.db.prepare(`
			SELECT
				(SELECT COUNT(*) FROM nexora_onboarding_provider_connections WHERE onboarding_mission_id=?1) AS provider_connections,
				(SELECT COUNT(*) FROM nexora_onboarding_token_connection_bindings) AS token_bindings,
				(SELECT COUNT(*) FROM nexora_provider_outcome_results WHERE mission_id=?1 AND outcome_kind='SUCCESS') AS provider_outcomes,
				(SELECT COUNT(*) FROM nexora_onboarding_evidence_outbox WHERE onboarding_mission_id=?1 AND status='DELIVERED') AS delivered_evidence,
				(SELECT COUNT(*) FROM mission_runtime_evidence WHERE mission_id=?1 AND claim_key='nexora_callback_outcome' AND status='supported') AS canonical_evidence,
				(SELECT COUNT(*) FROM nexora_callback_verification_attempts WHERE mission_id=?1 AND status='VERIFIED') AS verification_attempts,
				(SELECT COUNT(*) FROM nexora_callback_verified_results WHERE mission_id=?1 AND result_status='VERIFIED') AS verified_results,
				(SELECT COUNT(*) FROM nexora_callback_correlation_consumption_results WHERE mission_id=?1 AND status='CONSUMED') AS consumed_correlations,
				(SELECT COUNT(*) FROM nexora_mission_continuation_results WHERE mission_id=?1 AND status='CONTINUED') AS mission_continuations,
				(SELECT COUNT(*) FROM nexora_initial_sync_intents WHERE mission_id=?1 AND state='READY') AS sync_intents,
				(SELECT COUNT(*) FROM nexora_initial_sync_dispatches WHERE mission_id=?1 AND state='NOT_DISPATCHED') AS sync_dispatches,
				(SELECT COUNT(*) FROM nexora_autonomy_jobs WHERE job_type='ZERO_TOUCH_INITIAL_SYNC' AND state='QUEUED') AS sync_jobs
		`).bind(started.missionId).first();
		expect(Object.fromEntries(Object.entries(chain).map(([key, value]) => [key, Number(value)]))).toMatchObject({
			provider_connections: 1,
			token_bindings: 1,
			provider_outcomes: 1,
			delivered_evidence: 1,
			canonical_evidence: 1,
			verification_attempts: 1,
			verified_results: 1,
			consumed_correlations: 1,
			mission_continuations: 1,
			sync_intents: 1,
			sync_dispatches: 1,
			sync_jobs: 1,
		});
	});

	it('insufficient granted scope blocks with CAPABILITY_SCOPE_INSUFFICIENT rather than falsely proceeding to sync', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', NEXORA_GOOGLE_OAUTH_REDIRECT_URI: GOOGLE_REDIRECT_URI, jwt_secret: 'test-only-pool-workers-encryption-secret' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'chain-2' });
		// Provider grants only 'openid' -- not the requested gmail.readonly scope (e.g. user
		// denied part of the consent screen).
		const result = await onboardingOrchestrator.handleCallback(c, scope, { state: started.state, verifier: started.verifier, code: 'fixture-code-2', redirectUri: 'https://x/callback', callbackFingerprint: 'fp-chain-2', fetchImpl: fixtureFetch('openid', { sub: 'fixture-subject-2', email: 'user@example.com', nonce: started.nonce }), jwksFetchImpl: jwksFetch() });
		expect(result.capabilityStatus).not.toBe('SUPPORTED');
		expect(result.syncDispatched).toBe(false);
		expect(result.phase).toBe('blocked');
		const phaseRow = await env.db.prepare(`SELECT blocked_reason,required_human_actor FROM nexora_onboarding_state WHERE mission_id=?1`).bind(started.missionId).first();
		expect(phaseRow.blocked_reason).toBe('CAPABILITY_SCOPE_INSUFFICIENT');
		expect(phaseRow.required_human_actor).toBe('end_user');
	});

	it('a token-exchange failure (e.g. invalid_grant for a reused code) drives the phase to failed with the real error code, not silently ignored', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', NEXORA_GOOGLE_OAUTH_REDIRECT_URI: GOOGLE_REDIRECT_URI, jwt_secret: 'test-only-pool-workers-encryption-secret' } };
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

	it('newly wired: an identity conflict (returned email does not match the login hint the user started with) blocks and stores no token', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', NEXORA_GOOGLE_OAUTH_REDIRECT_URI: GOOGLE_REDIRECT_URI, jwt_secret: 'test-only-pool-workers-encryption-secret' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'chain-4', loginHint: 'expected@example.com' });
		const result = await onboardingOrchestrator.handleCallback(c, scope, { state: started.state, verifier: started.verifier, code: 'fixture-code-4', redirectUri: 'https://x/callback', callbackFingerprint: 'fp-chain-4', loginHint: 'expected@example.com', fetchImpl: fixtureFetch('openid email https://www.googleapis.com/auth/gmail.readonly', { sub: 'other-subject', email: 'someone-else@example.com', nonce: started.nonce }), jwksFetchImpl: jwksFetch() });
		expect(result.identityValid).toBe(false);
		expect(result.phase).toBe('blocked');
		const phaseRow = await env.db.prepare(`SELECT blocked_reason FROM nexora_onboarding_state WHERE mission_id=?1`).bind(started.missionId).first();
		expect(phaseRow.blocked_reason).toBe('IDENTITY_CONFLICT');
		const tokenCount = await env.db.prepare(`SELECT COUNT(*) n FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1`).bind(started.missionId).first();
		expect(Number(tokenCount.n)).toBe(0);
	});

	it('newly wired: a Microsoft tenant outside the allowed policy blocks and stores no token', async () => {
		const c = { env: { ...env, NEXORA_MICROSOFT_OAUTH_CLIENT_ID: 'test-ms-client-id', NEXORA_MICROSOFT_OAUTH_REDIRECT_URI: MICROSOFT_REDIRECT_URI, jwt_secret: 'test-only-pool-workers-encryption-secret' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'microsoft', capabilities: ['mail_read'], idempotencyKey: 'chain-5' });
		const result = await onboardingOrchestrator.handleCallback(c, scope, { state: started.state, verifier: started.verifier, code: 'fixture-code-5', redirectUri: 'https://x/callback', callbackFingerprint: 'fp-chain-5', allowedMicrosoftTenantIds: ['allowed-tenant'], fetchImpl: fixtureFetch('openid profile email Mail.Read', { sub: 'sub-5', tid: 'disallowed-tenant' }, { clientId: 'test-ms-client-id', issuer: 'https://login.microsoftonline.com/disallowed-tenant/v2.0' }), jwksFetchImpl: jwksFetch() });
		expect(result.identityValid).toBe(false);
		const phaseRow = await env.db.prepare(`SELECT blocked_reason FROM nexora_onboarding_state WHERE mission_id=?1`).bind(started.missionId).first();
		expect(phaseRow.blocked_reason).toBe('TENANT_POLICY_DENIED');
	});

	it('E28: a duplicate callback with a resupplied code never retries exchange; it creates one fenced replacement session', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', NEXORA_GOOGLE_OAUTH_REDIRECT_URI: GOOGLE_REDIRECT_URI, jwt_secret: 'test-only-pool-workers-encryption-secret' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'chain-6' });

		// First delivery: manually mark the session consumed WITHOUT ever storing a token,
		// simulating a Worker eviction between exchangeAuthorizationCode succeeding and
		// storeTokens completing on a real (uncaptured) prior attempt.
		await env.db.prepare(`UPDATE nexora_onboarding_authorization_sessions SET status='consumed',consumed_at=CURRENT_TIMESTAMP,resume_checkpoint=?2 WHERE onboarding_mission_id=?1`).bind(started.missionId, `resume:${started.missionId}`).run();
		const tokenCountBefore = await env.db.prepare(`SELECT COUNT(*) n FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1`).bind(started.missionId).first();
		expect(Number(tokenCountBefore.n)).toBe(0);

		let calls = 0;
		const result = await onboardingOrchestrator.handleCallback(c, scope, { state: started.state, verifier: started.verifier, code: 'fixture-code-6', redirectUri: 'https://x/callback', callbackFingerprint: 'fp-chain-6', fetchImpl: async () => { calls += 1; return fixtureFetch('openid email https://www.googleapis.com/auth/gmail.readonly')(); } });
		expect(result.duplicate).toBe(true);
		expect(result.recovery).toBe('REAUTHORIZATION_REQUIRED');
		expect(result.reauthorizationStatus).toBe('WAITING_FOR_USER');
		expect(result.replacementSessionId).toBeTruthy();
		expect(result.authorizationUrl).toContain('accounts.google.com');
		expect(calls).toBe(0);
		const work = await env.db.prepare(`SELECT * FROM nexora_onboarding_reauthorization_work WHERE onboarding_mission_id=?1`).bind(started.missionId).first();
		expect(work.original_authorization_session_id).not.toBe(work.replacement_authorization_session_id);
		expect(work.status).toBe('WAITING_FOR_USER');
		const duplicate = await onboardingOrchestrator.handleCallback(c, scope, { state: started.state, verifier: started.verifier, code: 'fixture-code-6', redirectUri: 'https://x/callback', callbackFingerprint: 'fp-chain-6-duplicate', fetchImpl: async () => { calls += 1; return fixtureFetch('openid email https://www.googleapis.com/auth/gmail.readonly')(); } });
		expect(duplicate.reauthorizationWorkId).toBe(work.id);
		expect(calls).toBe(0);
		const workCount = await env.db.prepare(`SELECT COUNT(*) n FROM nexora_onboarding_reauthorization_work WHERE onboarding_mission_id=?1`).bind(started.missionId).first();
		expect(Number(workCount.n)).toBe(1);
		const tokenCountAfter = await env.db.prepare(`SELECT COUNT(*) n FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1`).bind(started.missionId).first();
		expect(Number(tokenCountAfter.n)).toBe(0); // recovery must inspect durable evidence or reauthorize, never replay code
	});

	it('a genuinely-already-completed duplicate callback (token already stored) remains a true no-op, does not re-exchange', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', NEXORA_GOOGLE_OAUTH_REDIRECT_URI: GOOGLE_REDIRECT_URI, jwt_secret: 'test-only-pool-workers-encryption-secret' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'chain-7' });
		await onboardingOrchestrator.handleCallback(c, scope, { state: started.state, verifier: started.verifier, code: 'fixture-code-7', redirectUri: 'https://x/callback', callbackFingerprint: 'fp-chain-7', fetchImpl: fixtureFetch('openid email https://www.googleapis.com/auth/gmail.readonly', { sub: 'fixture-subject-1', email: 'user@example.com', nonce: started.nonce }),
			jwksFetchImpl: jwksFetch() });

		let calls = 0;
		const countingFetch = async (...args) => {
			calls += 1;
			return fixtureFetch('openid email https://www.googleapis.com/auth/gmail.readonly')(...args);
		};
		const duplicate = await onboardingOrchestrator.handleCallback(c, scope, { state: started.state, verifier: started.verifier, code: 'fixture-code-7', redirectUri: 'https://x/callback', callbackFingerprint: 'fp-chain-7-dup', fetchImpl: countingFetch });
		expect(duplicate.duplicate).toBe(true);
		expect(calls).toBe(0); // token already stored -- no re-exchange attempted
	});

	it('production hardening: an unsigned id_token blocks before token storage', async () => {
		const c = { env: { ...env, NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id', NEXORA_GOOGLE_OAUTH_REDIRECT_URI: GOOGLE_REDIRECT_URI, jwt_secret: 'test-only-pool-workers-encryption-secret' } };
		const started = await onboardingOrchestrator.startOnboarding(c, scope, { provider: 'google', capabilities: ['mail_read'], idempotencyKey: 'chain-unverified-id-token' });
		const unsignedToken = `${b64urlJson({ alg: 'none', typ: 'JWT', kid: 'fixture-kid-1' })}.${b64urlJson({ iss: 'https://accounts.google.com', aud: 'test-client-id', exp: Math.floor(Date.now() / 1000) + 3600, sub: 'fixture-subject', email: 'user@example.com', nonce: started.nonce })}.signature`;
		const result = await onboardingOrchestrator.handleCallback(c, scope, {
			state: started.state,
			verifier: started.verifier,
			code: 'fixture-code-unverified',
			redirectUri: 'https://x/callback',
			callbackFingerprint: 'fp-unverified-id-token',
			fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/gmail.readonly', id_token: unsignedToken }) }),
			jwksFetchImpl: jwksFetch(),
		});
		expect(result.idTokenVerified).toBe(false);
		expect(result.idTokenErrorCode).toBe('ID_TOKEN_MALFORMED');
		const tokenCount = await env.db.prepare(`SELECT COUNT(*) n FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1`).bind(started.missionId).first();
		expect(Number(tokenCount.n)).toBe(0);
	});
	});
