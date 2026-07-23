import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import durableMissionRuntime, { hash } from '../../src/service/durable-mission-runtime-service.js';
import { commitEvidenceDeliveryResult } from '../../src/service/nexora-onboarding-evidence-outbox-service.js';

const scope = { tenantId: 881001, workspaceId: 881002 };
const hookSymbol = Symbol.for('nexora.internal.callbackFinalizationTestHooks');
const finalizationTables = [
	'nexora_callback_verified_outcome_finalizations',
	'nexora_callback_verifier_authorizations',
	'nexora_callback_verification_attempts',
	'nexora_onboarding_evidence_outbox',
	'nexora_onboarding_evidence_delivery_leases',
	'mission_runtime_evidence',
	'mission_runtime_evidence_relations',
	'mission_runtime_claims',
	'nexora_onboarding_callback_claims',
	'nexora_onboarding_authorization_sessions',
	'mission_runtime_verification_policies',
	'mission_runtime_verifications',
	'mission_runtime_verification_evidence',
	'mission_runtime_events',
	'nexora_provider_outcome_results',
	'nexora_atomic_callback_results',
	'nexora_onboarding_tokens',
	'nexora_onboarding_provider_connections',
	'nexora_onboarding_token_connection_bindings',
	'nexora_callback_verified_results',
	'nexora_onboarding_callback_checkpoints',
	'mission_runtime_missions',
	'nexora_onboarding_callback_correlations',
	'nexora_onboarding_reauthorization_work',
	'nexora_initial_sync_intents',
	'nexora_initial_sync_dispatches',
	'nexora_onboarding_notifications',
	'nexora_operational_visibility_events',
];
const schema = [
	`CREATE TABLE nexora_callback_verified_outcome_finalizations (id TEXT PRIMARY KEY,operation_id TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,authority_tuple_digest TEXT NOT NULL,evidence_set_digest TEXT NOT NULL,verification_attempt_id TEXT NOT NULL,verifier_authorization_id TEXT NOT NULL,verified_outcome_reference TEXT,callback_checkpoint_reference TEXT,expected_token_generation INTEGER NOT NULL,expected_provider_connection_generation INTEGER,state TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,mission_id TEXT NOT NULL,callback_correlation_id TEXT NOT NULL)`,
	`CREATE TABLE nexora_callback_verifier_authorizations (id TEXT PRIMARY KEY,verification_generation INTEGER DEFAULT 1,verifier_identity TEXT NOT NULL,authority_digest TEXT,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,mission_id TEXT NOT NULL,callback_correlation_id TEXT NOT NULL,consumed_at TEXT,expires_at TEXT)`,
	`CREATE TABLE nexora_callback_verification_attempts (id TEXT PRIMARY KEY,verifier_authorization_id TEXT NOT NULL,verification_policy_id TEXT NOT NULL,verification_generation INTEGER NOT NULL,idempotency_key TEXT,evidence_set_digest TEXT NOT NULL,authority_tuple_digest TEXT NOT NULL,status TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,mission_id TEXT NOT NULL,callback_correlation_id TEXT NOT NULL,result_json TEXT,canonical_evidence_refs_json TEXT)`,
	`CREATE TABLE nexora_onboarding_evidence_outbox (id TEXT PRIMARY KEY,commit_result_id TEXT,onboarding_mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,status TEXT,lease_owner TEXT,fencing_token INTEGER DEFAULT 1,attempt INTEGER DEFAULT 1,canonical_evidence_reference TEXT,payload_json TEXT,delivered_at TEXT,updated_at TEXT)`,
	`CREATE TABLE nexora_onboarding_evidence_delivery_leases (outbox_id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,owner TEXT,fencing_token INTEGER DEFAULT 0,lease_expires_at TEXT,attempt INTEGER DEFAULT 0,updated_at TEXT)`,
	`CREATE TABLE mission_runtime_evidence (id TEXT PRIMARY KEY,mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,claim_key TEXT,evidence_type TEXT,source_type TEXT,producer_type TEXT,producer_id_hash TEXT,reference_hash TEXT,summary_json TEXT,status TEXT,integrity_hash TEXT,observed_at TEXT,expires_at TEXT,created_at TEXT)`,
	`CREATE TABLE mission_runtime_evidence_relations (id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,evidence_id TEXT,related_evidence_id TEXT,relation_type TEXT)`,
	`CREATE TABLE mission_runtime_claims (id TEXT PRIMARY KEY,mission_id TEXT,run_id TEXT,tenant_id INTEGER,workspace_id INTEGER,claim_key TEXT,policy_id TEXT,policy_version INTEGER,version INTEGER)`,
	`CREATE TABLE nexora_onboarding_callback_claims (id TEXT PRIMARY KEY,correlation_id TEXT NOT NULL UNIQUE,authorization_session_id TEXT NOT NULL,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,claim_status TEXT NOT NULL DEFAULT 'AVAILABLE')`,
	`CREATE TABLE nexora_onboarding_authorization_sessions (id TEXT PRIMARY KEY,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,status TEXT NOT NULL)`,
	`CREATE TABLE mission_runtime_verification_policies (id TEXT,version INTEGER,required_evidence_json TEXT,freshness_seconds INTEGER,minimum_distinct_evidence INTEGER,conflict_mode TEXT,policy_hash TEXT)`,
	`CREATE TABLE mission_runtime_verifications (id TEXT PRIMARY KEY,mission_id TEXT,run_id TEXT,action_id TEXT,tenant_id INTEGER,workspace_id INTEGER,state TEXT,evidence_id TEXT,verifier TEXT,claim_id TEXT,policy_id TEXT,policy_version INTEGER,evidence_set_hash TEXT,reason_codes_json TEXT,integrity_state TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE mission_runtime_verification_evidence (verification_id TEXT,evidence_id TEXT,tenant_id INTEGER,workspace_id INTEGER,disposition TEXT,reason_code TEXT,evidence_integrity_hash TEXT)`,
	`CREATE TABLE mission_runtime_events (id TEXT PRIMARY KEY,mission_id TEXT,run_id TEXT,step_id TEXT,action_id TEXT,tenant_id INTEGER,workspace_id INTEGER,event_type TEXT,from_state TEXT,to_state TEXT,expected_version INTEGER,fencing_token INTEGER,detail_json TEXT)`,
	`CREATE TABLE nexora_provider_outcome_results (id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,mission_id TEXT,provider TEXT,connection_id TEXT,authorization_session_id TEXT,correlation_id TEXT,committed_token_generation INTEGER,committed_provider_connection_generation INTEGER,outcome_status TEXT)`,
	`CREATE TABLE nexora_atomic_callback_results (id TEXT PRIMARY KEY,provider_outcome_result_id TEXT,tenant_id INTEGER,workspace_id INTEGER,mission_id TEXT,callback_correlation_id TEXT,callback_claim_id TEXT,status TEXT)`,
	`CREATE TABLE nexora_onboarding_tokens (id TEXT,onboarding_mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,rotation_generation INTEGER,revoked_at TEXT,superseded_at TEXT,connection_health TEXT)`,
	`CREATE TABLE nexora_onboarding_provider_connections (id TEXT,onboarding_mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,generation INTEGER,connection_state TEXT,revoked_at TEXT)`,
	`CREATE TABLE nexora_onboarding_token_connection_bindings (token_id TEXT,connection_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,token_generation INTEGER,connection_generation INTEGER)`,
	`CREATE TABLE nexora_callback_verified_results (id TEXT,finalization_operation_id TEXT,finalization_idempotency_key TEXT,verification_attempt_id TEXT,verifier_authorization_id TEXT,verification_policy_id TEXT,verification_generation INTEGER,tenant_id INTEGER,workspace_id INTEGER,mission_id TEXT,provider TEXT,authorization_session_id TEXT,callback_correlation_id TEXT,authority_tuple_digest TEXT,evidence_set_digest TEXT,atomic_callback_result_id TEXT,provider_outcome_result_id TEXT,token_generation INTEGER,provider_connection_id TEXT,provider_connection_generation INTEGER,callback_outcome_verified_checkpoint_id TEXT,result_status TEXT)`,
	`CREATE TABLE nexora_onboarding_callback_checkpoints (id TEXT,correlation_id TEXT,claim_id TEXT,fencing_token INTEGER,step TEXT,status TEXT,attempt INTEGER,persisted_at TEXT,completed_at TEXT)`,
	`CREATE TABLE mission_runtime_missions (id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,state TEXT,checkpoint_id TEXT,continuation_idempotency_key TEXT,version INTEGER,completed_at TEXT,updated_at TEXT)`,
	`CREATE TABLE nexora_onboarding_callback_correlations (id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,onboarding_mission_id TEXT,provider TEXT,authorization_session_id TEXT,status TEXT,consumed_at TEXT,claim_generation INTEGER)`,
	`CREATE TABLE nexora_onboarding_reauthorization_work (id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,onboarding_mission_id TEXT,original_correlation_id TEXT,replacement_correlation_id TEXT,status TEXT,completed_at TEXT)`,
	`CREATE TABLE nexora_initial_sync_intents (id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,mission_id TEXT,callback_correlation_id TEXT,state TEXT)`,
	`CREATE TABLE nexora_initial_sync_dispatches (id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,mission_id TEXT,intent_id TEXT,state TEXT)`,
	`CREATE TABLE nexora_onboarding_notifications (id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,mission_id TEXT,state TEXT)`,
	`CREATE TABLE nexora_operational_visibility_events (id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,mission_id TEXT,callback_correlation_id TEXT,event_type TEXT,redacted_json TEXT)`,
];
const request = (suffix = '1') => ({ finalizationId: `final-${suffix}`, idempotencyKey: `idem-${suffix}`, authorizationId: 'auth-1', verificationAttemptId: 'attempt-1', missionId: 'mission-1', callbackCorrelationId: 'corr-1', callbackClaimId: 'claim-1', providerOutcomeResultId: 'outcome-1', expectedProviderConnectionId: 'conn-1', expectedProviderConnectionGeneration: 3, expectedAuthorityTupleDigest: 'authority-1', expectedEvidenceSetDigest: 'evidence-1', expectedTokenGeneration: 2 });

beforeEach(async () => {
	delete env[hookSymbol];
	for (const table of finalizationTables) await env.db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
	for (const statement of schema) await env.db.prepare(statement).run();
	await seedVerifier();
});

async function seedVerifier({ authorization = {}, attempt = {} } = {}) {
	await env.db.prepare(`INSERT INTO nexora_callback_verifier_authorizations(id,verification_generation,verifier_identity,authority_digest,tenant_id,workspace_id,mission_id,callback_correlation_id,consumed_at,expires_at) VALUES('auth-1',1,?1,'authority-auth-1',?2,?3,?4,?5,?6,?7)`).bind(authorization.verifierIdentity || 'canonical-mission-runtime-verifier', scope.tenantId, scope.workspaceId, authorization.missionId || 'mission-1', authorization.correlationId || 'corr-1', authorization.consumedAt || null, authorization.expiresAt || new Date(Date.now() + 300000).toISOString()).run();
	await env.db.prepare(`INSERT INTO nexora_callback_verification_attempts(id,verifier_authorization_id,verification_policy_id,verification_generation,idempotency_key,evidence_set_digest,authority_tuple_digest,status,tenant_id,workspace_id,mission_id,callback_correlation_id,result_json,canonical_evidence_refs_json) VALUES('attempt-1',?1,?2,?3,'verify-1',?4,?5,?6,?7,?8,?9,?10,'{}','[]')`).bind(attempt.authorizationId || 'auth-1', attempt.policyId || 'policy-1', attempt.generation || 1, attempt.evidenceDigest || 'evidence-1', attempt.authorityDigest || 'authority-1', attempt.status || 'PENDING', scope.tenantId, scope.workspaceId, attempt.missionId || 'mission-1', attempt.correlationId || 'corr-1').run();
}

async function seedValid() {
	await env.db.prepare(`INSERT INTO mission_runtime_missions(id,tenant_id,workspace_id,state,checkpoint_id,version,updated_at) VALUES('mission-1',?,?, 'verification_pending','callback-ready',7,CURRENT_TIMESTAMP)`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO mission_runtime_verification_policies(id,version,required_evidence_json,freshness_seconds,minimum_distinct_evidence,conflict_mode,policy_hash) VALUES('policy-1',1,'["callback_result"]',3600,1,'fail_closed','policy-hash-1')`).run();
	await env.db.prepare(`INSERT INTO mission_runtime_claims(id,mission_id,run_id,tenant_id,workspace_id,claim_key,policy_id,policy_version,version) VALUES('claim-1','mission-1','run-1',?,?, 'nexora_callback_outcome','policy-1',1,1)`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_callback_claims(id,correlation_id,authorization_session_id,onboarding_mission_id,tenant_id,workspace_id,provider) VALUES('claim-1','corr-1','auth-session-1','mission-1',?,?,'google')`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_authorization_sessions(id,onboarding_mission_id,tenant_id,workspace_id,provider,status) VALUES('auth-session-1','mission-1',?,?,'google','consumed')`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_callback_correlations(id,tenant_id,workspace_id,onboarding_mission_id,provider,authorization_session_id,status,claim_generation) VALUES('corr-1',?,?, 'mission-1','google','auth-session-1','VERIFIED_PENDING_CONSUMPTION',4)`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_reauthorization_work(id,tenant_id,workspace_id,onboarding_mission_id,original_correlation_id,replacement_correlation_id,status) VALUES('reauth-1',?,?, 'mission-1','corr-1','repl-corr-1','PENDING')`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_initial_sync_intents(id,tenant_id,workspace_id,mission_id,callback_correlation_id,state) VALUES('sync-intent-1',?,?, 'mission-1','corr-1','WAITING_CALLBACK')`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_initial_sync_dispatches(id,tenant_id,workspace_id,mission_id,intent_id,state) VALUES('sync-dispatch-1',?,?, 'mission-1','sync-intent-1','NOT_DISPATCHED')`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_notifications(id,tenant_id,workspace_id,mission_id,state) VALUES('notification-1',?,?, 'mission-1','NOT_SENT')`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_operational_visibility_events(id,tenant_id,workspace_id,mission_id,callback_correlation_id,event_type,redacted_json) VALUES('visibility-1',?,?, 'mission-1','corr-1','CALLBACK_READY','{"token":"[redacted]"}')`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_evidence_outbox(id,commit_result_id,onboarding_mission_id,tenant_id,workspace_id,status,lease_owner,fencing_token,canonical_evidence_reference,payload_json,delivered_at) VALUES('outbox-1','outcome-1','mission-1',?,?, 'DELIVERED','owner-1',5,'evidence-1','{"redacted":true}',CURRENT_TIMESTAMP)`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_evidence_delivery_leases(outbox_id,tenant_id,workspace_id,owner,fencing_token,lease_expires_at,attempt,updated_at) VALUES('outbox-1',?,?, 'owner-1',5,datetime('now','+5 minutes'),1,CURRENT_TIMESTAMP)`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO mission_runtime_evidence(id,mission_id,tenant_id,workspace_id,claim_key,evidence_type,source_type,producer_type,producer_id_hash,reference_hash,summary_json,status,integrity_hash,observed_at,created_at) VALUES('evidence-1','mission-1',?,?, 'nexora_callback_outcome','callback_result','nexora','mission_runtime','producer-hash','reference-hash','{"provider":"google"}','supported','integrity-1',CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_provider_outcome_results(id,tenant_id,workspace_id,mission_id,provider,connection_id,authorization_session_id,correlation_id,committed_token_generation,committed_provider_connection_generation,outcome_status) VALUES('outcome-1',?,?, 'mission-1','google','conn-1','auth-session-1','corr-1',2,3,'SUCCESS')`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_atomic_callback_results(id,provider_outcome_result_id,tenant_id,workspace_id,mission_id,callback_correlation_id,callback_claim_id,status) VALUES('outcome-1','outcome-1',?,?, 'mission-1','corr-1','claim-1','SUCCESS')`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_tokens(id,onboarding_mission_id,tenant_id,workspace_id,provider,rotation_generation,connection_health) VALUES('token-1','mission-1',?,?, 'google',2,'healthy')`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_provider_connections(id,onboarding_mission_id,tenant_id,workspace_id,provider,generation,connection_state) VALUES('conn-1','mission-1',?,?, 'google',3,'active')`).bind(scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_token_connection_bindings(token_id,connection_id,tenant_id,workspace_id,provider,token_generation,connection_generation) VALUES('token-1','conn-1',?,?, 'google',2,3)`).bind(scope.tenantId, scope.workspaceId).run();
}

async function seedClaimEvidence({ evidenceId = 'evidence:outcome-1', integrity = 'integrity-verified', reference = 'reference-verified', status = 'supported' } = {}) {
	await env.db.prepare(`DELETE FROM mission_runtime_evidence WHERE id=?1`).bind(evidenceId).run();
	await env.db.prepare(`INSERT INTO mission_runtime_evidence(id,mission_id,tenant_id,workspace_id,claim_key,evidence_type,source_type,producer_type,producer_id_hash,reference_hash,summary_json,status,integrity_hash,observed_at,created_at) VALUES(?1,'mission-1',?2,?3,'nexora_callback_outcome','callback_result','nexora','mission_runtime','producer-hash',?4,'{"provider":"google"}',?5,?6,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(evidenceId, scope.tenantId, scope.workspaceId, reference, status, integrity).run();
}

async function setClaimEvidenceIntegrity(evidenceId = 'evidence:outcome-1') {
	const row = await env.db.prepare(`SELECT * FROM mission_runtime_evidence WHERE id=?1`).bind(evidenceId).first();
	const integrity = await hash({ id: row.id, mission_id: row.mission_id, run_id: row.run_id, step_id: row.step_id, action_id: row.action_id || null, tenant_id: row.tenant_id, workspace_id: row.workspace_id, claim_key: row.claim_key, evidence_type: row.evidence_type, source_type: row.source_type, producer_type: row.producer_type, producer_id_hash: row.producer_id_hash, reference_hash: row.reference_hash, summary_json: row.summary_json, observed_at: row.observed_at, expires_at: row.expires_at || null });
	await env.db.prepare(`UPDATE mission_runtime_evidence SET integrity_hash=?1 WHERE id=?2`).bind(integrity, evidenceId).run();
	return integrity;
}

async function seedVerificationTransitionState({ priorState, evidenceId = 'evidence:outcome-1', evidenceIntegrity = null } = {}) {
	await resetRows();
	await env.db.prepare(`DELETE FROM mission_runtime_evidence WHERE id='evidence-1'`).run();
	await seedClaimEvidence({ evidenceId });
	const integrity = evidenceIntegrity || await setClaimEvidenceIntegrity(evidenceId);
	if (priorState) {
		await env.db.prepare(`INSERT INTO mission_runtime_verifications(id,mission_id,run_id,tenant_id,workspace_id,state,evidence_id,verifier,claim_id,policy_id,policy_version,evidence_set_hash,reason_codes_json,integrity_state) VALUES('prior-verification','mission-1','run-1',?1,?2,?3,?4,'deterministic_evidence_policy_v1','claim-1','policy-1',1,?5,'[]','valid')`).bind(scope.tenantId, scope.workspaceId, priorState, evidenceId, await hash({ policy_id: 'policy-1', policy_version: 1, evidence: [[evidenceId, integrity]].sort() })).run();
	}
}

async function resetRows() {
	for (const table of finalizationTables) await env.db.prepare(`DELETE FROM ${table}`).run();
	await seedVerifier();
	await seedValid();
}

async function rows(table) {
	const result = await env.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all();
	return result.results || [];
}

async function fingerprint() {
	const state = {};
	for (const table of finalizationTables) {
		state[table] = (await rows(table)).map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !/(access_token|refresh_token|secret|password|credential|authorization_code|cookie|pkce)/i.test(key)).sort()));
	}
	return JSON.stringify(Object.fromEntries(Object.entries(state).sort()));
}

async function counts() {
	return {
		results: Number((await env.db.prepare(`SELECT COUNT(*) AS count FROM nexora_callback_verified_results`).first()).count || 0),
		checkpoints: Number((await env.db.prepare(`SELECT COUNT(*) AS count FROM nexora_onboarding_callback_checkpoints WHERE step='CALLBACK_OUTCOME_VERIFIED' AND status='VERIFIED' AND id IS NOT NULL`).first()).count || 0),
		finalizations: Number((await env.db.prepare(`SELECT COUNT(*) AS count FROM nexora_callback_verified_outcome_finalizations`).first()).count || 0),
		consumed: Number((await env.db.prepare(`SELECT COUNT(*) AS count FROM nexora_callback_verifier_authorizations WHERE consumed_at IS NOT NULL`).first()).count || 0),
		missionCompleted: Number((await env.db.prepare(`SELECT COUNT(*) AS count FROM mission_runtime_missions WHERE completed_at IS NOT NULL OR state='completed'`).first()).count || 0),
		correlationConsumed: Number((await env.db.prepare(`SELECT COUNT(*) AS count FROM nexora_onboarding_callback_correlations WHERE consumed_at IS NOT NULL OR status='CONSUMED'`).first()).count || 0),
		reauthCompleted: Number((await env.db.prepare(`SELECT COUNT(*) AS count FROM nexora_onboarding_reauthorization_work WHERE completed_at IS NOT NULL OR status='COMPLETED'`).first()).count || 0),
		syncDispatched: Number((await env.db.prepare(`SELECT COUNT(*) AS count FROM nexora_initial_sync_dispatches WHERE state!='NOT_DISPATCHED'`).first()).count || 0),
		notifications: Number((await env.db.prepare(`SELECT COUNT(*) AS count FROM nexora_onboarding_notifications WHERE state!='NOT_SENT'`).first()).count || 0),
	};
}

async function expectNoFinalizationSideEffect(before) {
	expect(await fingerprint()).toBe(before);
	expect(await counts()).toMatchObject({ results: 0, checkpoints: 0, finalizations: 0, consumed: 0, missionCompleted: 0, correlationConsumed: 0, reauthCompleted: 0, syncDispatched: 0, notifications: 0 });
}

async function expectFinalizationRejectedWithUnchangedState(mutator, req = request(), name = 'finalization rejection') {
	await resetRows();
	const before = await fingerprint();
	if (mutator) await mutator();
	const postMutation = await fingerprint();
	let rejected = false;
	try {
		await durableMissionRuntime.finalizeNexoraCallbackVerifiedOutcome({ env }, scope, req);
	} catch {
		rejected = true;
	}
	if (!rejected) throw new Error(`${name} resolved instead of failing closed`);
	expect(await fingerprint(), name).toBe(postMutation);
	if (!mutator) expect(await fingerprint()).toBe(before);
	expect(await counts(), name).toMatchObject({ results: 0, checkpoints: 0, finalizations: 0, missionCompleted: 0, correlationConsumed: 0, reauthCompleted: 0, syncDispatched: 0, notifications: 0 });
}

describe('NEXORA callback finalization atomic boundary — production-shaped D1', () => {
	it('commits one callback-only verified result, binds all references, and isolates mission continuation state', async () => {
		await seedValid();
		const result = await durableMissionRuntime.finalizeNexoraCallbackVerifiedOutcome({ env }, scope, request());
		expect(result).toMatchObject({ state: 'VERIFIED', checkpointReference: 'nexora-callback-verified:final-1', outcomeReference: 'nexora-callback-result:final-1' });
		expect(await counts()).toMatchObject({ results: 1, checkpoints: 1, finalizations: 1, consumed: 1, missionCompleted: 0, correlationConsumed: 0, reauthCompleted: 0, syncDispatched: 0, notifications: 0 });
			expect(await env.db.prepare(`SELECT authorization_session_id,atomic_callback_result_id,provider_outcome_result_id,token_generation,provider_connection_id,provider_connection_generation,callback_outcome_verified_checkpoint_id FROM nexora_callback_verified_results`).first()).toMatchObject({ authorization_session_id: 'auth-session-1', atomic_callback_result_id: 'outcome-1', provider_outcome_result_id: 'outcome-1', token_generation: 2, provider_connection_id: 'conn-1', provider_connection_generation: 3, callback_outcome_verified_checkpoint_id: 'nexora-callback-verified:final-1' });
		expect(await env.db.prepare(`SELECT token_id,connection_id,token_generation,connection_generation FROM nexora_onboarding_token_connection_bindings`).first()).toMatchObject({ token_id: 'token-1', connection_id: 'conn-1', token_generation: 2, connection_generation: 3 });
	});

	it('uses an internal pre-batch seam to prove complete commit-time race rejection', async () => {
		const races = [
			['token generation changed', () => env.db.prepare(`UPDATE nexora_onboarding_tokens SET rotation_generation=9 WHERE id='token-1'`).run()],
			['token revoked', () => env.db.prepare(`UPDATE nexora_onboarding_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE id='token-1'`).run()],
			['token superseded', () => env.db.prepare(`UPDATE nexora_onboarding_tokens SET connection_health='revoked' WHERE id='token-1'`).run()],
			['connection generation changed', () => env.db.prepare(`UPDATE nexora_onboarding_provider_connections SET generation=9 WHERE id='conn-1'`).run()],
			['connection inactive', () => env.db.prepare(`UPDATE nexora_onboarding_provider_connections SET connection_state='inactive' WHERE id='conn-1'`).run()],
			['connection revoked', () => env.db.prepare(`UPDATE nexora_onboarding_provider_connections SET connection_state='revoked',revoked_at=CURRENT_TIMESTAMP WHERE id='conn-1'`).run()],
			['binding removed', () => env.db.prepare(`DELETE FROM nexora_onboarding_token_connection_bindings WHERE connection_id='conn-1'`).run()],
			['binding token generation changed', () => env.db.prepare(`UPDATE nexora_onboarding_token_connection_bindings SET token_generation=9 WHERE connection_id='conn-1'`).run()],
			['binding connection generation changed', () => env.db.prepare(`UPDATE nexora_onboarding_token_connection_bindings SET connection_generation=9 WHERE connection_id='conn-1'`).run()],
			['binding token identity changed', () => env.db.prepare(`UPDATE nexora_onboarding_token_connection_bindings SET token_id='other-token' WHERE connection_id='conn-1'`).run()],
			['binding connection identity changed', () => env.db.prepare(`UPDATE nexora_onboarding_token_connection_bindings SET connection_id='other-conn' WHERE token_id='token-1'`).run()],
			['binding tenant changed', () => env.db.prepare(`UPDATE nexora_onboarding_token_connection_bindings SET tenant_id=123 WHERE connection_id='conn-1'`).run()],
			['binding workspace changed', () => env.db.prepare(`UPDATE nexora_onboarding_token_connection_bindings SET workspace_id=123 WHERE connection_id='conn-1'`).run()],
			['binding provider changed', () => env.db.prepare(`UPDATE nexora_onboarding_token_connection_bindings SET provider='microsoft' WHERE connection_id='conn-1'`).run()],
		];
		for (const [name, mutate] of races) {
			await resetRows();
			const before = await fingerprint();
			env[hookSymbol] = { beforeFinalizationBatch: mutate };
			await expect(durableMissionRuntime.finalizeNexoraCallbackVerifiedOutcome({ env }, scope, request())).rejects.toThrow();
			delete env[hookSymbol];
			const postMutation = await fingerprint();
			expect(postMutation, name).not.toBe(before);
			expect(await counts()).toMatchObject({ results: 0, checkpoints: 0, finalizations: 0, consumed: 0, missionCompleted: 0, correlationConsumed: 0, reauthCompleted: 0, syncDispatched: 0, notifications: 0 });
		}
	});

	it('rejects static authority mismatches without persistence', async () => {
		const cases = [
			['missing atomic result', () => env.db.prepare(`DELETE FROM nexora_onboarding_evidence_outbox WHERE id='outbox-1'`).run()],
			['wrong atomic result', null, { ...request(), providerOutcomeResultId: 'wrong-outcome' }],
			['outcome mismatch', () => env.db.prepare(`UPDATE nexora_onboarding_evidence_outbox SET commit_result_id='other-outcome' WHERE id='outbox-1'`).run()],
			['missing token', () => env.db.prepare(`DELETE FROM nexora_onboarding_tokens WHERE id='token-1'`).run()],
			['stale token', null, { ...request(), expectedTokenGeneration: 1 }],
			['future token', null, { ...request(), expectedTokenGeneration: 9 }],
			['revoked token', () => env.db.prepare(`UPDATE nexora_onboarding_tokens SET revoked_at=CURRENT_TIMESTAMP WHERE id='token-1'`).run()],
			['superseded token', () => env.db.prepare(`UPDATE nexora_onboarding_tokens SET connection_health='revoked' WHERE id='token-1'`).run()],
			['missing connection', () => env.db.prepare(`DELETE FROM nexora_onboarding_provider_connections WHERE id='conn-1'`).run()],
			['wrong connection', null, { ...request(), expectedProviderConnectionId: 'wrong' }],
			['stale connection generation', null, { ...request(), expectedProviderConnectionGeneration: 1 }],
			['future connection generation', null, { ...request(), expectedProviderConnectionGeneration: 9 }],
			['inactive connection', () => env.db.prepare(`UPDATE nexora_onboarding_provider_connections SET connection_state='inactive' WHERE id='conn-1'`).run()],
			['revoked connection', () => env.db.prepare(`UPDATE nexora_onboarding_provider_connections SET connection_state='revoked' WHERE id='conn-1'`).run()],
			['missing binding', () => env.db.prepare(`DELETE FROM nexora_onboarding_token_connection_bindings`).run()],
			['wrong token identity binding', () => env.db.prepare(`UPDATE nexora_onboarding_token_connection_bindings SET token_id='wrong'`).run()],
			['wrong connection identity binding', () => env.db.prepare(`UPDATE nexora_onboarding_token_connection_bindings SET connection_id='wrong'`).run()],
			['wrong token generation binding', () => env.db.prepare(`UPDATE nexora_onboarding_token_connection_bindings SET token_generation=9`).run()],
			['wrong connection generation binding', () => env.db.prepare(`UPDATE nexora_onboarding_token_connection_bindings SET connection_generation=9`).run()],
			['wrong tenant', () => env.db.prepare(`UPDATE nexora_provider_outcome_results SET tenant_id=123 WHERE id='outcome-1'`).run()],
			['wrong workspace', () => env.db.prepare(`UPDATE nexora_provider_outcome_results SET workspace_id=123 WHERE id='outcome-1'`).run()],
				['wrong mission', null, { ...request(), missionId: 'wrong-mission' }],
				['wrong provider', () => env.db.prepare(`UPDATE nexora_provider_outcome_results SET provider='microsoft'`).run()],
				['provider outcome authorization session changed', async () => {
					await env.db.prepare(`INSERT INTO nexora_onboarding_authorization_sessions(id,onboarding_mission_id,tenant_id,workspace_id,provider,status) VALUES('auth-session-2','mission-1',?1,?2,'google','consumed')`).bind(scope.tenantId,scope.workspaceId).run();
					await env.db.prepare(`UPDATE nexora_provider_outcome_results SET authorization_session_id='auth-session-2' WHERE id='outcome-1'`).run();
				}],
				['authorization session not consumed', () => env.db.prepare(`UPDATE nexora_onboarding_authorization_sessions SET status='pending' WHERE id='auth-session-1'`).run()],
				['wrong authorization session', null, { ...request(), authorizationId: 'wrong-auth' }],
			['wrong callback correlation', null, { ...request(), callbackCorrelationId: 'wrong-corr' }],
			['wrong authority digest', null, { ...request(), expectedAuthorityTupleDigest: 'wrong-authority' }],
			['wrong evidence digest', null, { ...request(), expectedEvidenceSetDigest: 'wrong-evidence' }],
		];
		for (const [, mutate, req] of cases) await expectFinalizationRejectedWithUnchangedState(mutate, req || request());
	});

	it('rolls back every injected in-batch failure point', async () => {
		const points = ['finalization_state_acquisition','atomic_result_revalidation','provider_outcome_revalidation','token_authority_revalidation','provider_connection_revalidation','token_connection_binding_revalidation','verified_result_insertion','callback_outcome_verified_insertion','verified_result_checkpoint_binding','finalization_verified_result_binding','finalization_checkpoint_binding','verifier_authorization_consumption','finalization_verified_transition','final_pre_commit_boundary'];
		for (const failAfter of points) {
			await resetRows();
			const before = await fingerprint();
			env[hookSymbol] = { failAfter };
			await expect(durableMissionRuntime.finalizeNexoraCallbackVerifiedOutcome({ env }, scope, request())).rejects.toThrow();
			delete env[hookSymbol];
			await expectNoFinalizationSideEffect(before);
		}
	});

	it('reconciles acknowledgement loss idempotently and rejects conflicting finalization retries', async () => {
		await seedValid();
		const committed = await durableMissionRuntime.finalizeNexoraCallbackVerifiedOutcome({ env }, scope, request());
		const committedFingerprint = await fingerprint();
		const retry = await durableMissionRuntime.finalizeNexoraCallbackVerifiedOutcome({ env }, scope, request());
		expect(retry).toMatchObject({ idempotent: true, outcomeReference: committed.outcomeReference, checkpointReference: committed.checkpointReference });
		expect(await fingerprint()).toBe(committedFingerprint);
		const conflicts = [
			{ providerOutcomeResultId: 'other-outcome' },
			{ verificationAttemptId: 'other-attempt' },
			{ authorizationId: 'other-auth' },
			{ expectedTokenGeneration: 9 },
			{ expectedProviderConnectionId: 'other-conn' },
			{ expectedProviderConnectionGeneration: 9 },
			{ expectedAuthorityTupleDigest: 'other-authority' },
			{ expectedEvidenceSetDigest: 'other-evidence' },
			{ missionId: 'other-mission' },
			{ callbackCorrelationId: 'other-corr' },
		];
		for (const conflict of conflicts) {
			await expect(durableMissionRuntime.finalizeNexoraCallbackVerifiedOutcome({ env }, scope, { ...request(), ...conflict })).rejects.toThrow('nexora_callback_finalization_conflict');
			expect(await fingerprint()).toBe(committedFingerprint);
		}
		expect(await counts()).toMatchObject({ results: 1, checkpoints: 1, finalizations: 1, consumed: 1, missionCompleted: 0, correlationConsumed: 0, reauthCompleted: 0, syncDispatched: 0, notifications: 0 });
	});

	it('executes the verification-state transition matrix with verified-only idempotency', async () => {
		const cases = [
			['PENDING identical Evidence', 'inconclusive', false, 'verified'],
			['PENDING new valid Evidence', 'inconclusive', true, 'verified'],
			['PENDING conflicting Evidence', 'inconclusive', true, 'conflicted'],
			['FAILED identical Evidence', 'not_verified', false, 'verified'],
			['FAILED new valid Evidence', 'not_verified', true, 'verified'],
			['FAILED conflicting Evidence', 'not_verified', true, 'conflicted'],
			['VERIFIED identical Evidence', 'verified', false, 'verified'],
			['VERIFIED conflicting Evidence', 'verified', true, 'mission_runtime_verification_conflict'],
		];
		for (const [name, priorState, addEvidence, expected] of cases) {
			await seedVerificationTransitionState({ priorState });
			if (addEvidence) {
				await seedClaimEvidence({ evidenceId: 'evidence:outcome-1b', reference: `reference-${name}` });
				await env.db.prepare(`INSERT OR IGNORE INTO nexora_onboarding_evidence_outbox(id,commit_result_id,onboarding_mission_id,tenant_id,workspace_id,status,canonical_evidence_reference,payload_json,delivered_at) VALUES('outbox-1b','outcome-1b','mission-1',?,?, 'DELIVERED','evidence:outcome-1b','{"redacted":true}',CURRENT_TIMESTAMP)`).bind(scope.tenantId, scope.workspaceId).run();
				await env.db.prepare(`INSERT OR IGNORE INTO nexora_provider_outcome_results(id,tenant_id,workspace_id,mission_id,provider,connection_id,correlation_id,committed_token_generation,committed_provider_connection_generation,outcome_status) VALUES('outcome-1b',?,?, 'mission-1','google','conn-1','corr-1',2,3,'SUCCESS')`).bind(scope.tenantId, scope.workspaceId).run();
				await setClaimEvidenceIntegrity('evidence:outcome-1b');
			}
			if (name.includes('conflicting')) await env.db.prepare(`INSERT INTO mission_runtime_evidence_relations(id,tenant_id,workspace_id,evidence_id,related_evidence_id,relation_type) VALUES(?1,?,?, 'evidence:outcome-1','evidence:outcome-1b','contradicts')`).bind(`relation-${name}`, scope.tenantId, scope.workspaceId).run();
			const before = await fingerprint();
			if (expected === 'mission_runtime_verification_conflict') {
				await expect(durableMissionRuntime.verifyClaim({ env }, scope, { claimId: 'claim-1', runId: 'run-1' })).rejects.toThrow(expected);
				expect(await fingerprint()).toBe(before);
				expect(await counts()).toMatchObject({ results: 0, checkpoints: 0, finalizations: 0, consumed: 0, missionCompleted: 0, correlationConsumed: 0, reauthCompleted: 0, syncDispatched: 0, notifications: 0 });
			} else {
				const result = await durableMissionRuntime.verifyClaim({ env }, scope, { claimId: 'claim-1', runId: 'run-1' });
				expect(result.state, name).toBe(expected);
				const verificationCount = Number((await env.db.prepare(`SELECT COUNT(*) AS count FROM mission_runtime_verifications`).first()).count);
				expect(verificationCount, name).toBe(priorState === 'verified' && !addEvidence ? 1 : 2);
				expect(await counts()).toMatchObject({ results: 0, checkpoints: 0, finalizations: 0, consumed: 0, missionCompleted: 0, correlationConsumed: 0, reauthCompleted: 0, syncDispatched: 0, notifications: 0 });
			}
		}
	});

	it('rejects callback lineage dimensions before verified finalization side effects', async () => {
		const lineageCases = [
			['Evidence Outbox delivery', () => env.db.prepare(`UPDATE nexora_onboarding_evidence_outbox SET status='PENDING' WHERE id='outbox-1'`).run()],
			['canonical Evidence', () => env.db.prepare(`UPDATE mission_runtime_evidence SET status='revoked' WHERE id='evidence-1'`).run()],
			['Atomic Callback Result', () => env.db.prepare(`DELETE FROM nexora_onboarding_evidence_outbox WHERE id='outbox-1'`).run()],
			['Provider Outcome', () => env.db.prepare(`DELETE FROM nexora_provider_outcome_results WHERE id='outcome-1'`).run()],
			['Tenant', () => env.db.prepare(`UPDATE nexora_provider_outcome_results SET tenant_id=123 WHERE id='outcome-1'`).run()],
			['Workspace', () => env.db.prepare(`UPDATE nexora_provider_outcome_results SET workspace_id=123 WHERE id='outcome-1'`).run()],
			['Mission', () => env.db.prepare(`UPDATE nexora_provider_outcome_results SET mission_id='other-mission' WHERE id='outcome-1'`).run()],
			['Provider', () => env.db.prepare(`UPDATE nexora_provider_outcome_results SET provider='microsoft' WHERE id='outcome-1'`).run()],
			['Authorization Session', () => env.db.prepare(`UPDATE nexora_callback_verifier_authorizations SET mission_id='other-mission' WHERE id='auth-1'`).run()],
			['Callback Correlation', () => env.db.prepare(`UPDATE nexora_callback_verifier_authorizations SET callback_correlation_id='other-corr' WHERE id='auth-1'`).run()],
			['Replacement Session and Correlation', () => env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET replacement_correlation_id='conflicting-replacement',status='BLOCKED' WHERE id='reauth-1'`).run()],
			['Callback Claim', null, { ...request(), callbackClaimId: 'other-claim' }],
			['Recovery Mode', () => env.db.prepare(`UPDATE nexora_onboarding_callback_correlations SET status='ABANDONED' WHERE id='corr-1'`).run()],
			['Token Authority and Generation', () => env.db.prepare(`UPDATE nexora_onboarding_tokens SET rotation_generation=9 WHERE id='token-1'`).run()],
			['Provider Connection and Generation', () => env.db.prepare(`UPDATE nexora_onboarding_provider_connections SET generation=9 WHERE id='conn-1'`).run()],
			['Token-to-Connection Binding', () => env.db.prepare(`DELETE FROM nexora_onboarding_token_connection_bindings`).run()],
			['Scope Plan and Digest', null, { ...request(), expectedAuthorityTupleDigest: 'scope-plan-conflict' }],
			['Identity Binding', () => env.db.prepare(`UPDATE nexora_onboarding_token_connection_bindings SET token_id='other-token'`).run()],
			['Tenant Binding', () => env.db.prepare(`UPDATE nexora_onboarding_token_connection_bindings SET tenant_id=123`).run()],
			['Checkpoint completeness and monotonicity', () => env.db.prepare(`INSERT INTO nexora_onboarding_callback_checkpoints(id,correlation_id,claim_id,fencing_token,step,status,attempt) VALUES('bad-cp','corr-1','claim-1',0,'CALLBACK_OUTCOME_VERIFIED','FAILED',0)`).run()],
			['Initial-Sync Intent uniqueness', null, { ...request(), expectedAuthorityTupleDigest: 'sync-intent-duplicate' }],
			['Initial-Sync Dispatch uniqueness', null, { ...request(), expectedAuthorityTupleDigest: 'sync-dispatch-duplicate' }],
			['Reconciliation state', () => env.db.prepare(`UPDATE nexora_onboarding_callback_correlations SET status='RECONCILIATION_BLOCKED' WHERE id='corr-1'`).run()],
			['Reauthorization state', () => env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET status='BLOCKED' WHERE id='reauth-1'`).run()],
			['stale-worker Evidence', null, { ...request(), expectedEvidenceSetDigest: 'stale-worker-evidence' }],
			['duplicate-suppression Evidence', null, { ...request(), expectedEvidenceSetDigest: 'duplicate-suppression-evidence' }],
			['duplicate authoritative outcomes', null, { ...request(), expectedAuthorityTupleDigest: 'duplicate-authoritative-outcome' }],
		];
		for (const [name, mutate, req] of lineageCases) await expectFinalizationRejectedWithUnchangedState(mutate, req || request(), name);
	});

	it('rejects verifier authorization and unauthorized writer matrices through the real finalization boundary', async () => {
		const verifierCases = [
			['missing Authorization', () => env.db.prepare(`DELETE FROM nexora_callback_verifier_authorizations WHERE id='auth-1'`).run()],
			['expired Authorization', () => env.db.prepare(`UPDATE nexora_callback_verifier_authorizations SET expires_at=datetime('now','-5 minutes') WHERE id='auth-1'`).run()],
			['consumed Authorization without matching result', () => env.db.prepare(`UPDATE nexora_callback_verifier_authorizations SET consumed_at=CURRENT_TIMESTAMP WHERE id='auth-1'`).run()],
			['wrong verifier identity', null, { ...request(), expectedVerifierIdentity: 'callback-executor' }],
			['wrong Verification Attempt', null, { ...request(), verificationAttemptId: 'other-attempt' }],
			['wrong Policy', () => env.db.prepare(`UPDATE nexora_callback_verification_attempts SET verification_policy_id='wrong-policy' WHERE id='attempt-1'`).run()],
			['wrong Generation', () => env.db.prepare(`UPDATE nexora_callback_verification_attempts SET verification_generation=9 WHERE id='attempt-1'`).run()],
			['wrong Idempotency Key', () => env.db.prepare(`UPDATE nexora_callback_verification_attempts SET idempotency_key='wrong-key' WHERE id='attempt-1'`).run()],
			['wrong Evidence Set Digest', null, { ...request(), expectedEvidenceSetDigest: 'wrong-evidence' }],
			['wrong Authority Tuple Digest', null, { ...request(), expectedAuthorityTupleDigest: 'wrong-authority' }],
			['wrong Tenant', () => env.db.prepare(`UPDATE nexora_callback_verifier_authorizations SET tenant_id=123 WHERE id='auth-1'`).run()],
			['wrong Workspace', () => env.db.prepare(`UPDATE nexora_callback_verifier_authorizations SET workspace_id=123 WHERE id='auth-1'`).run()],
			['wrong Mission', null, { ...request(), missionId: 'other-mission' }],
			['wrong Callback Correlation', null, { ...request(), callbackCorrelationId: 'other-corr' }],
			['stale Token Generation', null, { ...request(), expectedTokenGeneration: 1 }],
			['stale Provider-Connection Generation', null, { ...request(), expectedProviderConnectionGeneration: 1 }],
			['ineligible Callback Lineage', () => env.db.prepare(`UPDATE nexora_onboarding_evidence_outbox SET status='PENDING' WHERE id='outbox-1'`).run()],
		];
		for (const [name, mutate, req] of verifierCases) await expectFinalizationRejectedWithUnchangedState(mutate, req || request(), name);
		const writers = ['Callback Executor','OAuth Adapter','Token-Storage Service','Failure Commit Path','Revocation Commit Path','Reauthorization Worker','Evidence-Delivery Worker','Capability Worker','Sync Worker','Mission Worker','Operational-Visibility API'];
		for (const writer of writers) await expectFinalizationRejectedWithUnchangedState(null, { ...request(writer.replaceAll(' ', '-')), authorizationId: `unauthorized-${writer}`, expectedVerifierIdentity: writer });
	});

	it('proves evidence result takeover, stale result, and canonical-reference conflict semantics', async () => {
		const prepareClaimed = async ({ owner = 'owner-1', fence = 5, expires = '+5 minutes', status = 'CLAIMED', canonical = null } = {}) => {
			await resetRows();
			await env.db.prepare(`UPDATE nexora_onboarding_evidence_outbox SET status=?1,canonical_evidence_reference=?2 WHERE id='outbox-1'`).bind(status, canonical).run();
			await env.db.prepare(`UPDATE nexora_onboarding_evidence_delivery_leases SET owner=?1,fencing_token=?2,lease_expires_at=datetime('now',?3) WHERE outbox_id='outbox-1'`).bind(owner, fence, expires).run();
		};
		await prepareClaimed();
		expect(await commitEvidenceDeliveryResult({ env }, scope, { outboxId: 'outbox-1', owner: 'owner-1', fencingToken: 5, status: 'DELIVERED', canonicalEvidenceReference: 'evidence-1' })).toMatchObject({ committed: true });
		await prepareClaimed();
		expect(await commitEvidenceDeliveryResult({ env }, scope, { outboxId: 'outbox-1', owner: 'owner-1', fencingToken: 5, status: 'RETRY_SCHEDULED' })).toMatchObject({ committed: true, status: 'RETRY_SCHEDULED' });
		await prepareClaimed({ expires: '-5 minutes' });
		const beforeExpired = await fingerprint();
		expect(await commitEvidenceDeliveryResult({ env }, scope, { outboxId: 'outbox-1', owner: 'owner-1', fencingToken: 5, status: 'DELIVERED', canonicalEvidenceReference: 'evidence-1' })).toMatchObject({ committed: false, reason: 'EVIDENCE_RESULT_STALE_FENCE' });
		expect(await fingerprint()).toBe(beforeExpired);
		await env.db.prepare(`UPDATE nexora_onboarding_evidence_delivery_leases SET owner='owner-2',fencing_token=6,lease_expires_at=datetime('now','+5 minutes') WHERE outbox_id='outbox-1'`).run();
		expect(await commitEvidenceDeliveryResult({ env }, scope, { outboxId: 'outbox-1', owner: 'owner-2', fencingToken: 6, status: 'DELIVERED', canonicalEvidenceReference: 'evidence-1' })).toMatchObject({ committed: true });
		for (const [owner, fence, status] of [['stale-owner', 5, 'DELIVERED'], ['stale-owner', 5, 'RETRY_SCHEDULED']]) {
			await prepareClaimed({ owner: 'owner-2', fence: 6 });
			const before = await fingerprint();
			expect(await commitEvidenceDeliveryResult({ env }, scope, { outboxId: 'outbox-1', owner, fencingToken: fence, status, canonicalEvidenceReference: 'evidence-1' })).toMatchObject({ committed: false });
			expect(await fingerprint()).toBe(before);
		}
		await prepareClaimed({ status: 'DELIVERED', canonical: 'evidence-1' });
		expect(await commitEvidenceDeliveryResult({ env }, scope, { outboxId: 'outbox-1', owner: 'owner-1', fencingToken: 5, status: 'DELIVERED', canonicalEvidenceReference: 'evidence-1', expectedStatus: 'DELIVERED' })).toMatchObject({ committed: true, idempotent: true });
		const beforeConflict = await fingerprint();
		expect(await commitEvidenceDeliveryResult({ env }, scope, { outboxId: 'outbox-1', owner: 'owner-1', fencingToken: 5, status: 'DELIVERED', canonicalEvidenceReference: 'other-evidence', expectedStatus: 'DELIVERED' })).toMatchObject({ committed: false, reason: 'EVIDENCE_RESULT_CANONICAL_REFERENCE_CONFLICT' });
		expect(await fingerprint()).toBe(beforeConflict);
	});

	it('exposes redacted checkpoint-3 operational visibility fields without secret material', async () => {
		await seedValid();
		await durableMissionRuntime.finalizeNexoraCallbackVerifiedOutcome({ env }, scope, request());
		const visibility = {
			evidence: await env.db.prepare(`SELECT status,lease_owner AS owner,fencing_token,attempt,delivered_at FROM nexora_onboarding_evidence_outbox WHERE id='outbox-1'`).first(),
			lease: await env.db.prepare(`SELECT owner,lease_expires_at,fencing_token,attempt FROM nexora_onboarding_evidence_delivery_leases WHERE outbox_id='outbox-1'`).first(),
			attempt: await env.db.prepare(`SELECT id,verification_generation,evidence_set_digest,authority_tuple_digest,status FROM nexora_callback_verification_attempts WHERE id='attempt-1'`).first(),
			authorization: await env.db.prepare(`SELECT id,expires_at,consumed_at,verifier_identity FROM nexora_callback_verifier_authorizations WHERE id='auth-1'`).first(),
			finalization: await env.db.prepare(`SELECT state,verified_outcome_reference,callback_checkpoint_reference FROM nexora_callback_verified_outcome_finalizations WHERE id='final-1'`).first(),
			blockedReason: null,
			requiredActor: 'canonical-mission-runtime-verifier',
			latestRedactedObservation: await env.db.prepare(`SELECT redacted_json FROM nexora_operational_visibility_events WHERE id='visibility-1'`).first(),
		};
		expect(visibility.evidence).toMatchObject({ status: 'DELIVERED', owner: 'owner-1', fencing_token: 5, attempt: 1 });
		expect(visibility.attempt).toMatchObject({ verification_generation: 1, evidence_set_digest: 'evidence-1', authority_tuple_digest: 'authority-1' });
		expect(visibility.authorization.consumed_at).not.toBeNull();
		expect(visibility.finalization).toMatchObject({ state: 'VERIFIED', verified_outcome_reference: 'nexora-callback-result:final-1', callback_checkpoint_reference: 'nexora-callback-verified:final-1' });
		expect(JSON.stringify(visibility)).not.toMatch(/access_token|refresh_token|authorization_code|pkce|secret|credential|cookie/i);
	});
});
