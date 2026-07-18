import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import continuation from '../../src/service/nexora-callback-continuation-service.js';

const scope = { tenantId: 9901, workspaceId: 9902 };
const base = {
	missionId: 'mission-4',
	provider: 'google',
	authorizationSessionId: 'auth-session-4',
	callbackCorrelationId: 'corr-4',
	replacementAuthorizationSessionId: 'replacement-session-4',
	replacementCorrelationId: 'replacement-corr-4',
	reauthorizationWorkId: 'reauth-4',
	verifiedResultId: 'verified-4',
	finalizationId: 'final-4',
	verifierAuthorizationId: 'verifier-auth-4',
	verificationAttemptId: 'attempt-4',
	expectedVerificationPolicyId: 'policy-4',
	expectedVerificationGeneration: 4,
	expectedVerificationIdempotencyKey: 'verify-4',
	authorityTupleDigest: 'authority-digest-4',
	evidenceSetDigest: 'evidence-digest-4',
	expectedTokenGeneration: 8,
	expectedProviderConnectionId: 'conn-4',
	expectedProviderConnectionGeneration: 9,
	owner: 'worker-current',
	fencingToken: 44,
	expectedCorrelationState: 'VERIFIED_PENDING_CONSUMPTION',
	resumeCheckpoint: 'resume-checkpoint-4',
	expectedMissionState: 'verification_pending',
};

const completionArgs = (overrides = {}) => ({ ...base, idempotencyKey: 'reauth-complete-key-4', completionId: 'reauth-completion-4', ...overrides });
const consumptionArgs = (overrides = {}) => ({ ...base, idempotencyKey: 'consume-key-4', consumptionId: 'consumption-4', missionContinuationId: 'continuation-4', reauthorizationCompletionId: 'reauth-completion-4', ...overrides });
const missionArgs = (overrides = {}) => ({ ...base, idempotencyKey: 'mission-continue-key-4', continuationId: 'continuation-4', correlationConsumptionId: 'consumption-4', ...overrides });

const tables = [
	'nexora_reauthorization_completion_results',
	'nexora_callback_correlation_consumption_results',
	'nexora_mission_continuation_results',
	'nexora_callback_verified_results',
	'nexora_callback_verified_outcome_finalizations',
	'nexora_callback_verifier_authorizations',
	'nexora_callback_verification_attempts',
	'nexora_onboarding_callback_checkpoints',
	'nexora_onboarding_evidence_outbox',
	'nexora_provider_outcome_results',
	'nexora_onboarding_reauthorization_work',
	'nexora_onboarding_callback_correlations',
	'nexora_onboarding_callback_claims',
	'nexora_onboarding_tokens',
	'nexora_onboarding_provider_connections',
	'nexora_onboarding_token_connection_bindings',
	'mission_runtime_missions',
	'nexora_initial_sync_intents',
	'nexora_initial_sync_dispatches',
	'nexora_autonomy_jobs',
	'nexora_onboarding_notifications',
];

const schema = [
	`CREATE TABLE nexora_reauthorization_completion_results (id TEXT PRIMARY KEY,reauthorization_work_id TEXT NOT NULL UNIQUE,idempotency_key TEXT NOT NULL UNIQUE,authority_tuple_digest TEXT NOT NULL,evidence_set_digest TEXT NOT NULL,verified_result_id TEXT NOT NULL UNIQUE,finalization_id TEXT NOT NULL,verifier_authorization_id TEXT NOT NULL,verification_attempt_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,mission_id TEXT NOT NULL,provider TEXT NOT NULL,authorization_session_id TEXT NOT NULL,callback_correlation_id TEXT NOT NULL,replacement_authorization_session_id TEXT,replacement_correlation_id TEXT,token_generation INTEGER NOT NULL,provider_connection_id TEXT NOT NULL,provider_connection_generation INTEGER NOT NULL,lease_owner TEXT NOT NULL,fencing_token INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,completed_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE nexora_callback_correlation_consumption_results (id TEXT PRIMARY KEY,correlation_id TEXT NOT NULL UNIQUE,idempotency_key TEXT NOT NULL UNIQUE,mission_continuation_id TEXT NOT NULL UNIQUE,reauthorization_completion_id TEXT,verified_result_id TEXT NOT NULL,finalization_id TEXT NOT NULL,verifier_authorization_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,mission_id TEXT NOT NULL,provider TEXT NOT NULL,authorization_session_id TEXT NOT NULL,replacement_authorization_session_id TEXT,replacement_correlation_id TEXT,token_generation INTEGER NOT NULL,provider_connection_id TEXT NOT NULL,provider_connection_generation INTEGER NOT NULL,lease_owner TEXT NOT NULL,fencing_token INTEGER NOT NULL,status TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,consumed_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE nexora_mission_continuation_results (id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,correlation_consumption_id TEXT NOT NULL UNIQUE,verified_result_id TEXT NOT NULL,mission_id TEXT NOT NULL UNIQUE,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,resume_checkpoint TEXT NOT NULL,token_generation INTEGER NOT NULL,provider_connection_id TEXT NOT NULL,provider_connection_generation INTEGER NOT NULL,lease_owner TEXT NOT NULL,fencing_token INTEGER NOT NULL,sync_intent_id TEXT,sync_dispatch_id TEXT,sync_job_id TEXT,notification_id TEXT,status TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP,continued_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE nexora_callback_verified_results (id TEXT PRIMARY KEY,finalization_operation_id TEXT,finalization_idempotency_key TEXT,verification_attempt_id TEXT,verifier_authorization_id TEXT,verification_policy_id TEXT,verification_generation INTEGER,tenant_id INTEGER,workspace_id INTEGER,mission_id TEXT,provider TEXT,authorization_session_id TEXT,callback_correlation_id TEXT,replacement_authorization_session_id TEXT,replacement_correlation_id TEXT,authority_tuple_digest TEXT,evidence_set_digest TEXT,atomic_callback_result_id TEXT,provider_outcome_result_id TEXT,token_generation INTEGER,provider_connection_id TEXT,provider_connection_generation INTEGER,callback_outcome_verified_checkpoint_id TEXT,result_status TEXT)`,
	`CREATE TABLE nexora_callback_verified_outcome_finalizations (id TEXT PRIMARY KEY,authority_tuple_digest TEXT,evidence_set_digest TEXT,verified_outcome_reference TEXT,callback_checkpoint_reference TEXT,state TEXT)`,
	`CREATE TABLE nexora_callback_verifier_authorizations (id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,mission_id TEXT,callback_correlation_id TEXT,consumed_at TEXT)`,
	`CREATE TABLE nexora_callback_verification_attempts (id TEXT PRIMARY KEY,verifier_authorization_id TEXT,verification_policy_id TEXT,verification_generation INTEGER,idempotency_key TEXT,authority_tuple_digest TEXT,evidence_set_digest TEXT,status TEXT,tenant_id INTEGER,workspace_id INTEGER,mission_id TEXT,callback_correlation_id TEXT)`,
	`CREATE TABLE nexora_onboarding_callback_checkpoints (id TEXT PRIMARY KEY,correlation_id TEXT,claim_id TEXT,step TEXT,status TEXT)`,
	`CREATE TABLE nexora_onboarding_evidence_outbox (id TEXT PRIMARY KEY,commit_result_id TEXT,onboarding_mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,status TEXT)`,
	`CREATE TABLE nexora_provider_outcome_results (id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,mission_id TEXT,provider TEXT,connection_id TEXT,committed_token_generation INTEGER,committed_provider_connection_generation INTEGER,outcome_status TEXT)`,
	`CREATE TABLE nexora_onboarding_reauthorization_work (id TEXT PRIMARY KEY,original_correlation_id TEXT,original_authorization_session_id TEXT,replacement_authorization_session_id TEXT,replacement_correlation_id TEXT,onboarding_mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,replacement_token_generation INTEGER,status TEXT,lease_owner TEXT,lease_expires_at TEXT,fencing_token INTEGER,completed_at TEXT,updated_at TEXT)`,
	`CREATE TABLE nexora_onboarding_callback_correlations (id TEXT PRIMARY KEY,onboarding_mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,authorization_session_id TEXT,status TEXT,consumed_at TEXT,claimed_by TEXT,claim_expires_at TEXT,claim_generation INTEGER,resume_checkpoint TEXT)`,
	`CREATE TABLE nexora_onboarding_callback_claims (id TEXT PRIMARY KEY,correlation_id TEXT,recovery_mode TEXT,claim_status TEXT)`,
	`CREATE TABLE nexora_onboarding_tokens (id TEXT PRIMARY KEY,onboarding_mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,rotation_generation INTEGER,revoked_at TEXT,connection_health TEXT)`,
	`CREATE TABLE nexora_onboarding_provider_connections (id TEXT PRIMARY KEY,onboarding_mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,generation INTEGER,connection_state TEXT)`,
	`CREATE TABLE nexora_onboarding_token_connection_bindings (token_id TEXT,connection_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,token_generation INTEGER,connection_generation INTEGER)`,
	`CREATE TABLE mission_runtime_missions (id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,state TEXT,checkpoint_id TEXT,continuation_idempotency_key TEXT,updated_at TEXT)`,
	`CREATE TABLE nexora_initial_sync_intents (id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,mission_id TEXT,callback_correlation_id TEXT,state TEXT)`,
	`CREATE TABLE nexora_initial_sync_dispatches (id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,mission_id TEXT,intent_id TEXT,state TEXT)`,
	`CREATE TABLE nexora_autonomy_jobs (id TEXT PRIMARY KEY,user_id INTEGER,job_type TEXT,idempotency_key TEXT UNIQUE,state TEXT,input_json TEXT)`,
	`CREATE TABLE nexora_onboarding_notifications (id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,mission_id TEXT,state TEXT)`,
];

beforeEach(async () => {
	await resetDb();
});

async function resetDb() {
	for (const table of tables) await env.db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
	for (const statement of schema) await env.db.prepare(statement).run();
	await seedValid();
}

async function seedValid() {
	await env.db.prepare(`INSERT INTO nexora_callback_verified_results(id,finalization_operation_id,verification_attempt_id,verifier_authorization_id,verification_policy_id,verification_generation,tenant_id,workspace_id,mission_id,provider,authorization_session_id,callback_correlation_id,replacement_authorization_session_id,replacement_correlation_id,authority_tuple_digest,evidence_set_digest,atomic_callback_result_id,provider_outcome_result_id,token_generation,provider_connection_id,provider_connection_generation,callback_outcome_verified_checkpoint_id,result_status) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,'atomic-4','outcome-4',?17,?18,?19,'cp-4','VERIFIED')`).bind(base.verifiedResultId, base.finalizationId, base.verificationAttemptId, base.verifierAuthorizationId, base.expectedVerificationPolicyId, base.expectedVerificationGeneration, scope.tenantId, scope.workspaceId, base.missionId, base.provider, base.authorizationSessionId, base.callbackCorrelationId, base.replacementAuthorizationSessionId, base.replacementCorrelationId, base.authorityTupleDigest, base.evidenceSetDigest, base.expectedTokenGeneration, base.expectedProviderConnectionId, base.expectedProviderConnectionGeneration).run();
	await env.db.prepare(`INSERT INTO nexora_callback_verified_outcome_finalizations(id,authority_tuple_digest,evidence_set_digest,verified_outcome_reference,callback_checkpoint_reference,state) VALUES(?1,?2,?3,?4,'cp-4','VERIFIED')`).bind(base.finalizationId, base.authorityTupleDigest, base.evidenceSetDigest, base.verifiedResultId).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_callback_checkpoints(id,correlation_id,claim_id,step,status) VALUES('cp-4',?1,'claim-4','CALLBACK_OUTCOME_VERIFIED','VERIFIED')`).bind(base.callbackCorrelationId).run();
	await env.db.prepare(`INSERT INTO nexora_callback_verifier_authorizations(id,tenant_id,workspace_id,mission_id,callback_correlation_id,consumed_at) VALUES(?1,?2,?3,?4,?5,CURRENT_TIMESTAMP)`).bind(base.verifierAuthorizationId, scope.tenantId, scope.workspaceId, base.missionId, base.callbackCorrelationId).run();
	await env.db.prepare(`INSERT INTO nexora_callback_verification_attempts(id,verifier_authorization_id,verification_policy_id,verification_generation,idempotency_key,authority_tuple_digest,evidence_set_digest,status,tenant_id,workspace_id,mission_id,callback_correlation_id) VALUES(?1,?2,?3,?4,?5,?6,?7,'VERIFIED',?8,?9,?10,?11)`).bind(base.verificationAttemptId, base.verifierAuthorizationId, base.expectedVerificationPolicyId, base.expectedVerificationGeneration, base.expectedVerificationIdempotencyKey, base.authorityTupleDigest, base.evidenceSetDigest, scope.tenantId, scope.workspaceId, base.missionId, base.callbackCorrelationId).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_evidence_outbox(id,commit_result_id,onboarding_mission_id,tenant_id,workspace_id,status) VALUES('outbox-4','outcome-4',?1,?2,?3,'DELIVERED')`).bind(base.missionId, scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_provider_outcome_results(id,tenant_id,workspace_id,mission_id,provider,connection_id,committed_token_generation,committed_provider_connection_generation,outcome_status) VALUES('outcome-4',?,?,?,?,'conn-4',?,?,'SUCCESS')`).bind(scope.tenantId, scope.workspaceId, base.missionId, base.provider, base.expectedTokenGeneration, base.expectedProviderConnectionGeneration).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_reauthorization_work(id,original_correlation_id,original_authorization_session_id,replacement_authorization_session_id,replacement_correlation_id,onboarding_mission_id,tenant_id,workspace_id,provider,replacement_token_generation,status,lease_owner,lease_expires_at,fencing_token) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'AUTHORITY_RECEIVED',?11,datetime('now','+5 minutes'),?12)`).bind(base.reauthorizationWorkId, base.callbackCorrelationId, base.authorizationSessionId, base.replacementAuthorizationSessionId, base.replacementCorrelationId, base.missionId, scope.tenantId, scope.workspaceId, base.provider, base.expectedTokenGeneration, base.owner, base.fencingToken).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_callback_correlations(id,onboarding_mission_id,tenant_id,workspace_id,provider,authorization_session_id,status,consumed_at,claimed_by,claim_expires_at,claim_generation,resume_checkpoint) VALUES(?1,?2,?3,?4,?5,?6,?7,NULL,?8,datetime('now','+5 minutes'),?9,?10)`).bind(base.callbackCorrelationId, base.missionId, scope.tenantId, scope.workspaceId, base.provider, base.authorizationSessionId, base.expectedCorrelationState, base.owner, base.fencingToken, base.resumeCheckpoint).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_callback_claims(id,correlation_id,recovery_mode,claim_status) VALUES('claim-4',?1,'REAUTHORIZATION','COMPLETED')`).bind(base.callbackCorrelationId).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_tokens(id,onboarding_mission_id,tenant_id,workspace_id,provider,rotation_generation,revoked_at,connection_health) VALUES('token-4',?1,?2,?3,?4,?5,NULL,'healthy')`).bind(base.missionId, scope.tenantId, scope.workspaceId, base.provider, base.expectedTokenGeneration).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_provider_connections(id,onboarding_mission_id,tenant_id,workspace_id,provider,generation,connection_state) VALUES(?1,?2,?3,?4,?5,?6,'active')`).bind(base.expectedProviderConnectionId, base.missionId, scope.tenantId, scope.workspaceId, base.provider, base.expectedProviderConnectionGeneration).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_token_connection_bindings(token_id,connection_id,tenant_id,workspace_id,provider,token_generation,connection_generation) VALUES('token-4',?1,?2,?3,?4,?5,?6)`).bind(base.expectedProviderConnectionId, scope.tenantId, scope.workspaceId, base.provider, base.expectedTokenGeneration, base.expectedProviderConnectionGeneration).run();
	await env.db.prepare(`INSERT INTO mission_runtime_missions(id,tenant_id,workspace_id,state,checkpoint_id) VALUES(?1,?2,?3,?4,?5)`).bind(base.missionId, scope.tenantId, scope.workspaceId, base.expectedMissionState, base.resumeCheckpoint).run();
}

async function snapshot() {
	const out = {};
	for (const table of tables) out[table] = (await env.db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all()).results;
	return JSON.stringify(out);
}

async function expectRejectedUnchanged(fn) {
	const before = await snapshot();
	await expect(fn()).rejects.toThrow();
	expect(await snapshot()).toBe(before);
}

async function completedPrelude() {
	const completed = await continuation.completeReauthorization({ env }, scope, completionArgs());
	return { completed };
}

async function successfulPrelude() {
	const { completed } = await completedPrelude();
	const consumed = await continuation.consumeCorrelation({ env }, scope, consumptionArgs({ reauthorizationCompletionId: completed.id }));
	return { completed, consumed };
}

describe('NEXORA callback Checkpoint 4 exact-once continuation boundary', () => {
	it('completes guarded reauthorization exactly once and rejects conflicting duplicate completion', async () => {
		const first = await continuation.completeReauthorization({ env }, scope, completionArgs());
		expect(first).toMatchObject({ id: 'reauth-completion-4', idempotent: false, status: 'COMPLETED' });
		const duplicate = await continuation.completeReauthorization({ env }, scope, completionArgs());
		expect(duplicate).toMatchObject({ id: first.id, idempotent: true });
		await expect(continuation.completeReauthorization({ env }, scope, completionArgs({ expectedTokenGeneration: 99 }))).rejects.toThrow(/conflict|stale|mismatch|invalid/);
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_reauthorization_completion_results`).first()).n)).toBe(1);
		expect((await env.db.prepare(`SELECT status FROM nexora_onboarding_reauthorization_work WHERE id=?1`).bind(base.reauthorizationWorkId).first()).status).toBe('COMPLETED');
	});

	it('rejects the guarded reauthorization completion matrix without side effects', async () => {
		const cases = [
			['missing Canonical Verified Result', () => env.db.prepare(`DELETE FROM nexora_callback_verified_results`).run()],
			['missing CALLBACK_OUTCOME_VERIFIED', () => env.db.prepare(`DELETE FROM nexora_onboarding_callback_checkpoints`).run()],
			['non-VERIFIED Finalization', () => env.db.prepare(`UPDATE nexora_callback_verified_outcome_finalizations SET state='PENDING'`).run()],
			['unconsumed Verifier Authorization', () => env.db.prepare(`UPDATE nexora_callback_verifier_authorizations SET consumed_at=NULL`).run()],
			['wrong Verification Attempt', () => env.db.prepare(`UPDATE nexora_callback_verified_results SET verification_attempt_id='wrong'`).run()],
			['wrong Authority Tuple digest', () => env.db.prepare(`UPDATE nexora_callback_verified_results SET authority_tuple_digest='wrong'`).run()],
			['wrong Evidence Set digest', () => env.db.prepare(`UPDATE nexora_callback_verified_results SET evidence_set_digest='wrong'`).run()],
			['wrong Tenant', () => env.db.prepare(`UPDATE nexora_callback_verified_results SET tenant_id=7`).run()],
			['wrong Workspace', () => env.db.prepare(`UPDATE nexora_callback_verified_results SET workspace_id=7`).run()],
			['wrong Mission', () => env.db.prepare(`UPDATE nexora_callback_verified_results SET mission_id='wrong'`).run()],
			['wrong Provider', () => env.db.prepare(`UPDATE nexora_callback_verified_results SET provider='microsoft'`).run()],
			['wrong Session', () => env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET original_authorization_session_id='wrong'`).run()],
			['wrong Callback Correlation', () => env.db.prepare(`UPDATE nexora_callback_verified_results SET callback_correlation_id='wrong'`).run()],
			['wrong Replacement Session', () => env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET replacement_authorization_session_id='wrong'`).run()],
			['wrong Replacement Correlation', () => env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET replacement_correlation_id='wrong'`).run()],
			['stale Token Generation', () => env.db.prepare(`UPDATE nexora_onboarding_tokens SET rotation_generation=99`).run()],
			['stale Provider-Connection Generation', () => env.db.prepare(`UPDATE nexora_onboarding_provider_connections SET generation=99`).run()],
			['missing Token-to-Connection Binding', () => env.db.prepare(`DELETE FROM nexora_onboarding_token_connection_bindings`).run()],
			['pending Evidence', () => env.db.prepare(`UPDATE nexora_onboarding_evidence_outbox SET status='PENDING'`).run()],
			['failed Evidence', () => env.db.prepare(`UPDATE nexora_onboarding_evidence_outbox SET status='FAILED'`).run()],
			['unresolved Reconciliation', () => env.db.prepare(`UPDATE nexora_onboarding_callback_claims SET recovery_mode='RECONCILIATION',claim_status='CLAIMED'`).run()],
			['blocked Verification', () => env.db.prepare(`INSERT INTO nexora_callback_verification_attempts(id,verifier_authorization_id,verification_policy_id,verification_generation,idempotency_key,authority_tuple_digest,evidence_set_digest,status,tenant_id,workspace_id,mission_id,callback_correlation_id) VALUES('blocked','x','policy-4',4,'x','x','x','BLOCKED',?,?,?,?)`).bind(scope.tenantId, scope.workspaceId, base.missionId, base.callbackCorrelationId).run()],
			['cancelled Reauthorization', () => env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET status='CANCELLED'`).run()],
			['terminal conflicting Reauthorization', () => env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET status='FAILED'`).run()],
			['stale Fence', () => env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET fencing_token=45`).run()],
			['expired Lease', () => env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET lease_expires_at=datetime('now','-1 minute')`).run()],
			['wrong Owner', () => env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET lease_owner='other'`).run()],
		];
		for (const [name, mutate] of cases) {
			await resetDb();
			await mutate();
			await expectRejectedUnchanged(() => continuation.completeReauthorization({ env }, scope, completionArgs({ completionId: `completion-${name}` })));
		}
	});

	it('consumes callback correlation exactly once after completion and rejects stale/conflicting consumption', async () => {
		const { completed } = await completedPrelude();
		const first = await continuation.consumeCorrelation({ env }, scope, consumptionArgs({ reauthorizationCompletionId: completed.id }));
		expect(first).toMatchObject({ id: 'consumption-4', idempotent: false, status: 'CONSUMED' });
		const retry = await continuation.consumeCorrelation({ env }, scope, consumptionArgs({ reauthorizationCompletionId: completed.id }));
		expect(retry).toMatchObject({ id: first.id, idempotent: true });
		await expect(continuation.consumeCorrelation({ env }, scope, consumptionArgs({ reauthorizationCompletionId: completed.id, missionContinuationId: 'other' }))).rejects.toThrow(/conflict/);
		expect((await env.db.prepare(`SELECT status FROM nexora_onboarding_callback_correlations WHERE id=?1`).bind(base.callbackCorrelationId).first()).status).toBe('CONSUMED');
	});

	it('rejects the correlation-consumption matrix with exact fingerprint equality', async () => {
		const cases = [
			['missing verified callback outcome', () => env.db.prepare(`DELETE FROM nexora_callback_verified_results`).run()],
			['incomplete Reauthorization', () => env.db.prepare(`DELETE FROM nexora_reauthorization_completion_results`).run()],
			['wrong Tenant', () => env.db.prepare(`UPDATE nexora_onboarding_callback_correlations SET tenant_id=7`).run()],
			['wrong Workspace', () => env.db.prepare(`UPDATE nexora_onboarding_callback_correlations SET workspace_id=7`).run()],
			['wrong Mission', () => env.db.prepare(`UPDATE nexora_onboarding_callback_correlations SET onboarding_mission_id='wrong'`).run()],
			['wrong Provider', () => env.db.prepare(`UPDATE nexora_onboarding_callback_correlations SET provider='microsoft'`).run()],
			['wrong Session', () => env.db.prepare(`UPDATE nexora_onboarding_callback_correlations SET authorization_session_id='wrong'`).run()],
			['wrong Replacement lineage', () => env.db.prepare(`UPDATE nexora_reauthorization_completion_results SET replacement_correlation_id='wrong'`).run()],
			['stale Token Generation', () => env.db.prepare(`UPDATE nexora_onboarding_tokens SET rotation_generation=99`).run()],
			['stale Connection Generation', () => env.db.prepare(`UPDATE nexora_onboarding_provider_connections SET generation=99`).run()],
			['wrong Correlation state', () => env.db.prepare(`UPDATE nexora_onboarding_callback_correlations SET status='claimed'`).run()],
			['stale Fence', () => env.db.prepare(`UPDATE nexora_onboarding_callback_correlations SET claim_generation=45`).run()],
			['expired Lease', () => env.db.prepare(`UPDATE nexora_onboarding_callback_correlations SET claim_expires_at=datetime('now','-1 minute')`).run()],
			['wrong Owner', () => env.db.prepare(`UPDATE nexora_onboarding_callback_correlations SET claimed_by='other'`).run()],
			['already consumed by another Continuation', () => env.db.prepare(`UPDATE nexora_onboarding_callback_correlations SET consumed_at=CURRENT_TIMESTAMP,status='CONSUMED'`).run()],
			['conflicting Mission-Continuation identity', () => env.db.prepare(`INSERT INTO nexora_callback_correlation_consumption_results(id,correlation_id,idempotency_key,mission_continuation_id,verified_result_id,finalization_id,verifier_authorization_id,tenant_id,workspace_id,mission_id,provider,authorization_session_id,token_generation,provider_connection_id,provider_connection_generation,lease_owner,fencing_token,status) VALUES('other-consumption',?1,'other-key','other-cont',?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,'CONSUMED')`).bind(base.callbackCorrelationId, base.verifiedResultId, base.finalizationId, base.verifierAuthorizationId, scope.tenantId, scope.workspaceId, base.missionId, base.provider, base.authorizationSessionId, base.expectedTokenGeneration, base.expectedProviderConnectionId, base.expectedProviderConnectionGeneration, base.owner, base.fencingToken).run()],
		];
		for (const [name, mutate] of cases) {
			await resetDb();
			const completed = await continuation.completeReauthorization({ env }, scope, completionArgs({ completionId: `completion-${name}` }));
			await mutate();
			await expectRejectedUnchanged(() => continuation.consumeCorrelation({ env }, scope, consumptionArgs({ reauthorizationCompletionId: completed.id, consumptionId: `consume-${name}` })));
		}
	});

	it('continues exactly one original Mission after consumption without duplicate sync or notifications', async () => {
		const { consumed } = await successfulPrelude();
		const first = await continuation.continueMission({ env }, scope, missionArgs({ correlationConsumptionId: consumed.id }));
		expect(first).toMatchObject({ id: 'continuation-4', idempotent: false, status: 'CONTINUED' });
		const retry = await continuation.continueMission({ env }, scope, missionArgs({ correlationConsumptionId: consumed.id }));
		expect(retry).toMatchObject({ id: first.id, idempotent: true });
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM mission_runtime_missions WHERE id=?1`).bind(base.missionId).first()).n)).toBe(1);
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_initial_sync_intents`).first()).n)).toBe(1);
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_initial_sync_dispatches`).first()).n)).toBe(1);
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_autonomy_jobs WHERE job_type='ZERO_TOUCH_INITIAL_SYNC'`).first()).n)).toBe(1);
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_onboarding_notifications`).first()).n)).toBe(1);
	});

	it('rejects exact-once continuation, restart, and takeover matrix without duplicate effects', async () => {
		const cases = [
			['wrong Mission', () => env.db.prepare(`UPDATE mission_runtime_missions SET id='wrong'`).run()],
			['wrong resume checkpoint', () => env.db.prepare(`UPDATE mission_runtime_missions SET checkpoint_id='wrong'`).run()],
			['wrong Tenant', () => env.db.prepare(`UPDATE mission_runtime_missions SET tenant_id=7`).run()],
			['wrong Workspace', () => env.db.prepare(`UPDATE mission_runtime_missions SET workspace_id=7`).run()],
			['missing verified callback outcome', () => env.db.prepare(`DELETE FROM nexora_callback_verified_results`).run()],
			['incomplete Reauthorization', () => env.db.prepare(`DELETE FROM nexora_reauthorization_completion_results`).run()],
			['unconsumed Correlation', () => env.db.prepare(`DELETE FROM nexora_callback_correlation_consumption_results`).run()],
			['stale Token Generation', () => env.db.prepare(`UPDATE nexora_onboarding_tokens SET rotation_generation=99`).run()],
			['stale Provider-Connection Generation', () => env.db.prepare(`UPDATE nexora_onboarding_provider_connections SET generation=99`).run()],
			['stale Fence', () => env.db.prepare(`UPDATE nexora_callback_correlation_consumption_results SET fencing_token=45`).run()],
			['expired Lease', () => env.db.prepare(`UPDATE nexora_callback_correlation_consumption_results SET lease_owner='expired-worker'`).run()],
			['wrong Owner', () => env.db.prepare(`UPDATE nexora_callback_correlation_consumption_results SET lease_owner='other'`).run()],
			['existing successful Continuation', () => env.db.prepare(`INSERT INTO nexora_mission_continuation_results(id,idempotency_key,correlation_consumption_id,verified_result_id,mission_id,tenant_id,workspace_id,provider,resume_checkpoint,token_generation,provider_connection_id,provider_connection_generation,lease_owner,fencing_token,status) VALUES('other','other-key','other-consume',?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'CONTINUED')`).bind(base.verifiedResultId, base.missionId, scope.tenantId, scope.workspaceId, base.provider, base.resumeCheckpoint, base.expectedTokenGeneration, base.expectedProviderConnectionId, base.expectedProviderConnectionGeneration, base.owner, base.fencingToken).run()],
			['duplicate Initial-Sync Intent attempt', () => env.db.prepare(`INSERT INTO nexora_initial_sync_intents(id,tenant_id,workspace_id,mission_id,callback_correlation_id,state) VALUES('sync-intent:continuation-4',?,?,?,?,'READY')`).bind(scope.tenantId, scope.workspaceId, base.missionId, base.callbackCorrelationId).run()],
			['duplicate Initial-Sync Dispatch attempt', () => env.db.prepare(`INSERT INTO nexora_initial_sync_dispatches(id,tenant_id,workspace_id,mission_id,intent_id,state) VALUES('sync-dispatch:continuation-4',?,?,?,'sync-intent:continuation-4','READY')`).bind(scope.tenantId, scope.workspaceId, base.missionId).run()],
			['duplicate Sync Job attempt', () => env.db.prepare(`INSERT INTO nexora_autonomy_jobs(id,user_id,job_type,idempotency_key,state,input_json) VALUES('sync-job:continuation-4',?,'ZERO_TOUCH_INITIAL_SYNC','sync-job:continuation-4','QUEUED','{}')`).bind(scope.tenantId).run()],
			['duplicate Notification attempt', () => env.db.prepare(`INSERT INTO nexora_onboarding_notifications(id,tenant_id,workspace_id,mission_id,state) VALUES('notification:continuation-4',?,?,?,'NOT_SENT')`).bind(scope.tenantId, scope.workspaceId, base.missionId).run()],
		];
		for (const [name, mutate] of cases) {
			await resetDb();
			const { consumed } = await successfulPrelude();
			await mutate();
			await expectRejectedUnchanged(() => continuation.continueMission({ env }, scope, missionArgs({ correlationConsumptionId: consumed.id, continuationId: `continuation-${name}` })));
		}
	});

	it('rejects stale result reports across callback, evidence, verification, continuation, sync, and notification boundaries', async () => {
		const cases = [
			['Callback success', () => env.db.prepare(`UPDATE nexora_provider_outcome_results SET outcome_status='STALE_SUCCESS'`).run(), () => continuation.completeReauthorization({ env }, scope, completionArgs())],
			['Callback failure', () => env.db.prepare(`UPDATE nexora_provider_outcome_results SET outcome_status='FAILED'`).run(), () => continuation.completeReauthorization({ env }, scope, completionArgs())],
			['Callback revocation', () => env.db.prepare(`UPDATE nexora_provider_outcome_results SET outcome_status='REVOKED'`).run(), () => continuation.completeReauthorization({ env }, scope, completionArgs())],
			['Evidence-delivery success', () => env.db.prepare(`UPDATE nexora_onboarding_evidence_outbox SET status='PENDING'`).run(), () => continuation.completeReauthorization({ env }, scope, completionArgs())],
			['Evidence-delivery failure', () => env.db.prepare(`UPDATE nexora_onboarding_evidence_outbox SET status='FAILED'`).run(), () => continuation.completeReauthorization({ env }, scope, completionArgs())],
			['Verification result', () => env.db.prepare(`UPDATE nexora_callback_verification_attempts SET status='BLOCKED'`).run(), () => continuation.completeReauthorization({ env }, scope, completionArgs())],
			['Reauthorization Completion', async () => { await continuation.completeReauthorization({ env }, scope, completionArgs()); await env.db.prepare(`UPDATE nexora_reauthorization_completion_results SET token_generation=99`).run(); }, () => continuation.consumeCorrelation({ env }, scope, consumptionArgs({ reauthorizationCompletionId: 'reauth-completion-4' }))],
			['Correlation Consumption', async () => { const { consumed } = await successfulPrelude(); await env.db.prepare(`UPDATE nexora_callback_correlation_consumption_results SET token_generation=99 WHERE id=?1`).bind(consumed.id).run(); }, () => continuation.continueMission({ env }, scope, missionArgs({ correlationConsumptionId: 'consumption-4' }))],
			['Mission Continuation', async () => { const { consumed } = await successfulPrelude(); await continuation.continueMission({ env }, scope, missionArgs({ correlationConsumptionId: consumed.id })); }, () => continuation.continueMission({ env }, scope, missionArgs({ correlationConsumptionId: 'consumption-4', expectedTokenGeneration: 99 }))],
			['Initial-Sync Intent', async () => { const { consumed } = await successfulPrelude(); await env.db.prepare(`INSERT INTO nexora_initial_sync_intents(id,tenant_id,workspace_id,mission_id,callback_correlation_id,state) VALUES('sync-intent:continuation-4',?,?,?,?,'STALE')`).bind(scope.tenantId, scope.workspaceId, base.missionId, base.callbackCorrelationId).run(); }, () => continuation.continueMission({ env }, scope, missionArgs({ correlationConsumptionId: 'consumption-4' }))],
			['Initial-Sync Dispatch', async () => { const { consumed } = await successfulPrelude(); await env.db.prepare(`INSERT INTO nexora_initial_sync_dispatches(id,tenant_id,workspace_id,mission_id,intent_id,state) VALUES('sync-dispatch:continuation-4',?,?,?,'sync-intent:continuation-4','STALE')`).bind(scope.tenantId, scope.workspaceId, base.missionId).run(); }, () => continuation.continueMission({ env }, scope, missionArgs({ correlationConsumptionId: 'consumption-4' }))],
			['Notification result', async () => { const { consumed } = await successfulPrelude(); await env.db.prepare(`INSERT INTO nexora_onboarding_notifications(id,tenant_id,workspace_id,mission_id,state) VALUES('notification:continuation-4',?,?,?,'STALE')`).bind(scope.tenantId, scope.workspaceId, base.missionId).run(); }, () => continuation.continueMission({ env }, scope, missionArgs({ correlationConsumptionId: 'consumption-4' }))],
		];
		for (const [, mutate, invoke] of cases) {
			await resetDb();
			await mutate();
			await expectRejectedUnchanged(invoke);
		}
	});

	it('executes the zero-touch logical journey to logic-ready state without duplicate effects', async () => {
		const { completed, consumed } = await successfulPrelude();
		const continued = await continuation.continueMission({ env }, scope, missionArgs({ correlationConsumptionId: consumed.id }));
		const status = await continuation.checkpoint4Status({ env }, scope, { missionId: base.missionId });
		expect(completed.status).toBe('COMPLETED');
		expect(consumed.status).toBe('CONSUMED');
		expect(continued.status).toBe('CONTINUED');
		expect(status.restart_state).toBe('continued');
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM mission_runtime_missions`).first()).n)).toBe(1);
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_initial_sync_intents`).first()).n)).toBe(1);
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_initial_sync_dispatches`).first()).n)).toBe(1);
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_autonomy_jobs`).first()).n)).toBe(1);
		expect(Number((await env.db.prepare(`SELECT COUNT(*) n FROM nexora_onboarding_notifications`).first()).n)).toBe(1);
		expect(JSON.stringify(status)).not.toMatch(/authorization_code|pkce|secret|cookie|refresh|access/i);
	});

	it('reports redacted checkpoint-4 operational visibility', async () => {
		const { consumed } = await successfulPrelude();
		await continuation.continueMission({ env }, scope, missionArgs({ correlationConsumptionId: consumed.id }));
		const status = await continuation.checkpoint4Status({ env }, scope, { missionId: base.missionId });
		expect(status.restart_state).toBe('continued');
		expect(status.takeover_state).toBe('lease_and_fence_required');
		expect(JSON.stringify(status)).not.toMatch(/token-|authorization_code|pkce|secret|cookie|refresh|access/i);
		expect(status.mission_continuation[0].resume_checkpoint).toBe(base.resumeCheckpoint);
	});
});
