import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import tokenStorage from '../../src/service/nexora-onboarding-token-storage-service.js';
import fingerprint from '../../src/service/nexora-onboarding-state-fingerprint-service.js';

const scope = { tenantId: 881001, workspaceId: 881002 };
const mission = 'rollback-mission';
const args = { onboardingMissionId: mission, provider: 'google', providerAccountHash: 'acct-hash', reauthorizationWorkId: 'work-1', replacementAuthorizationSessionId: 'replacement-session', replacementCorrelationId: 'replacement-correlation', callbackClaim: { id: 'claim-1', lease_owner: 'worker-a', fencing_token: 7, attempt: 1 }, expectedRotationGeneration: null, refreshToken: 'refresh-secret', accessToken: 'access-secret', grantedScopes: ['openid', 'mail.read'] };
const schema = [
 `CREATE TABLE nexora_onboarding_tokens (id TEXT PRIMARY KEY,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,provider_account_hash TEXT NOT NULL,refresh_token_ciphertext TEXT NOT NULL,access_token_ciphertext TEXT,access_token_expires_at TEXT,granted_scopes_json TEXT NOT NULL,rotation_generation INTEGER NOT NULL DEFAULT 1,connection_health TEXT NOT NULL DEFAULT 'healthy',revoked_at TEXT,revoked_reason TEXT,refresh_failure_count INTEGER NOT NULL DEFAULT 0,UNIQUE(onboarding_mission_id))`,
 `CREATE TABLE nexora_onboarding_reauthorization_work (id TEXT PRIMARY KEY,original_correlation_id TEXT NOT NULL,original_authorization_session_id TEXT NOT NULL,replacement_authorization_session_id TEXT UNIQUE,replacement_correlation_id TEXT UNIQUE,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,requested_capabilities_json TEXT NOT NULL DEFAULT '[]',scope_plan_reference TEXT,scope_plan_digest TEXT,expected_token_generation INTEGER,replacement_token_generation INTEGER,status TEXT NOT NULL,fencing_token INTEGER NOT NULL DEFAULT 7,attempt INTEGER NOT NULL DEFAULT 1,updated_at TEXT)`,
 `CREATE TABLE nexora_onboarding_callback_claims (id TEXT PRIMARY KEY,correlation_id TEXT NOT NULL,authorization_session_id TEXT NOT NULL,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,lease_owner TEXT NOT NULL,fencing_token INTEGER NOT NULL,recovery_mode TEXT NOT NULL,claim_status TEXT NOT NULL,lease_expires_at TEXT NOT NULL)`,
 `CREATE TABLE nexora_onboarding_callback_correlations (id TEXT PRIMARY KEY,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,status TEXT NOT NULL,resume_checkpoint TEXT,claim_generation INTEGER NOT NULL DEFAULT 1)`,
 `CREATE TABLE nexora_onboarding_authorization_sessions (id TEXT PRIMARY KEY,onboarding_mission_id TEXT NOT NULL,status TEXT NOT NULL,session_generation INTEGER NOT NULL DEFAULT 1)`,
 `CREATE TABLE nexora_onboarding_callback_checkpoints (id TEXT PRIMARY KEY,correlation_id TEXT NOT NULL,claim_id TEXT NOT NULL,fencing_token INTEGER NOT NULL,step TEXT NOT NULL,status TEXT NOT NULL,attempt INTEGER NOT NULL,persisted_at TEXT,completed_at TEXT,token_generation_reference INTEGER,UNIQUE(correlation_id,step))`,
 `CREATE TABLE nexora_onboarding_reauthorization_commit_results (id TEXT PRIMARY KEY,reauthorization_work_id TEXT NOT NULL UNIQUE,idempotency_key TEXT NOT NULL UNIQUE,authority_tuple_hash TEXT NOT NULL,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,replacement_authorization_session_id TEXT NOT NULL,replacement_correlation_id TEXT NOT NULL,expected_prior_checkpoint TEXT NOT NULL,expected_token_generation INTEGER,committed_token_generation INTEGER NOT NULL,callback_claim_id TEXT NOT NULL,fencing_token INTEGER NOT NULL,status TEXT NOT NULL)`,
 `CREATE TABLE nexora_onboarding_evidence_outbox (id TEXT PRIMARY KEY,commit_result_id TEXT NOT NULL UNIQUE,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,event_type TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'PENDING',attempts INTEGER NOT NULL DEFAULT 0,delivered_at TEXT)`,
 `CREATE TABLE nexora_onboarding_state (mission_id TEXT PRIMARY KEY,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,phase TEXT NOT NULL,blocked_reason TEXT)`,
 `CREATE TABLE nexora_onboarding_sync_intents (id TEXT PRIMARY KEY,mission_id TEXT NOT NULL)`,
 `CREATE TABLE nexora_onboarding_sync_jobs (id TEXT PRIMARY KEY,mission_id TEXT NOT NULL)`,
 `CREATE TABLE nexora_onboarding_provider_connections (id TEXT PRIMARY KEY,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,connection_identity TEXT NOT NULL,generation INTEGER NOT NULL DEFAULT 1,connection_state TEXT NOT NULL DEFAULT 'active',UNIQUE(tenant_id,workspace_id,provider,connection_identity))`,
];

async function reset() {
	for (const table of ['nexora_onboarding_tokens','nexora_onboarding_reauthorization_work','nexora_onboarding_callback_claims','nexora_onboarding_callback_correlations','nexora_onboarding_authorization_sessions','nexora_onboarding_callback_checkpoints','nexora_onboarding_reauthorization_commit_results','nexora_onboarding_evidence_outbox','nexora_onboarding_state','nexora_onboarding_sync_intents','nexora_onboarding_sync_jobs','nexora_onboarding_provider_connections']) await env.db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
	for (const statement of schema) await env.db.prepare(statement).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_state VALUES(?,?,?,'onboarding',NULL)`).bind(mission, scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_authorization_sessions VALUES('original-session',?,'consumed',1),('replacement-session',?,'consumed',1)`).bind(mission, mission).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_callback_correlations VALUES('original-correlation',?,?,?,'google','consumed','resume:m',1),('replacement-correlation',?,?,?,'google','claimed','resume:m',1)`).bind(mission, scope.tenantId, scope.workspaceId, mission, scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_callback_claims VALUES('claim-1','replacement-correlation','replacement-session',?,?,?,?, 'worker-a',7,'EXECUTION','CLAIMED','2099-01-01 00:00:00')`).bind(mission, scope.tenantId, scope.workspaceId, 'google').run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_reauthorization_work VALUES('work-1','original-correlation','original-session','replacement-session','replacement-correlation',?,?,?,'google','["mail.read"]','scope-plan:1','digest:1',NULL,NULL,'WAITING_FOR_USER',7,1,CURRENT_TIMESTAMP)`).bind(mission, scope.tenantId, scope.workspaceId).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_callback_checkpoints VALUES('prior-checkpoint','replacement-correlation','claim-1',7,'TOKEN_EXCHANGE_RESPONSE_OBSERVED','PERSISTED',1,NULL,NULL,NULL)`).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_provider_connections VALUES('connection-1',?,?,?,'google','acct-hash',1,'active')`).bind(mission, scope.tenantId, scope.workspaceId).run();
}

const c = { env: { ...env, jwt_secret: 'rollback-test-secret-1234567890' } };

describe('NEXORA atomic replacement rollback and acknowledgement loss', () => {
	beforeEach(reset);
	it('rolls back every injection point and reconciles an acknowledged-loss retry', async () => {
		for (const point of ['token_insertion_or_update','reauthorization_work_advancement','checkpoint_insertion','immutable_result_insertion','evidence_outbox_insertion']) {
			const before = await fingerprint.fingerprintReplacementAuthorityState(c, { missionId: mission, ...scope });
			const failed = await tokenStorage.commitReauthorizationWithFence(c, scope, { ...args, failureInjection: point });
			expect(failed.committed).toBe(false);
			const after = await fingerprint.fingerprintReplacementAuthorityState(c, { missionId: mission, ...scope });
			expect(after.digest).toBe(before.digest);
			expect((await env.db.prepare(`SELECT COUNT(*) AS n FROM nexora_onboarding_tokens`).first()).n).toBe(0);
			expect((await env.db.prepare(`SELECT status FROM nexora_onboarding_reauthorization_work WHERE id='work-1'`).first()).status).toBe('WAITING_FOR_USER');
			const retry = await tokenStorage.commitReauthorizationWithFence(c, scope, args);
			expect(retry.committed, retry.failureDetail || JSON.stringify(retry)).toBe(true);
			await reset();
		}
	});

	it('returns the original immutable result after acknowledgement loss and rejects conflicts', async () => {
		const committed = await tokenStorage.commitReauthorizationWithFence(c, scope, args);
		expect(committed.committed, committed.failureDetail || JSON.stringify(committed)).toBe(true);
		const committedState = await fingerprint.fingerprintReplacementAuthorityState(c, { missionId: mission, ...scope });
		const retry = await tokenStorage.commitReauthorizationWithFence(c, scope, args);
		expect(retry.idempotent).toBe(true);
		expect(retry.rotationGeneration).toBe(committed.rotationGeneration);
		const retriedState = await fingerprint.fingerprintReplacementAuthorityState(c, { missionId: mission, ...scope });
		expect(retriedState.digest).toBe(committedState.digest);
		const conflict = await tokenStorage.commitReauthorizationWithFence(c, scope, { ...args, grantedScopes: ['openid', 'different'] });
		expect(conflict.committed).toBe(false);
		expect(conflict.reason).toBe('REAUTHORIZATION_IDEMPOTENCY_CONFLICT');
		expect((await fingerprint.fingerprintReplacementAuthorityState(c, { missionId: mission, ...scope })).digest).toBe(committedState.digest);
	});

	it('rejects the negative authority matrix without changing D1 state', async () => {
		const cases = [
			['stale fence', { callbackClaim: { ...args.callbackClaim, fencing_token: 6 } }],
			['expired lease', { callbackClaim: { ...args.callbackClaim }, db: `UPDATE nexora_onboarding_callback_claims SET lease_expires_at='2000-01-01 00:00:00' WHERE id='claim-1'` }],
			['wrong owner', { callbackClaim: { ...args.callbackClaim, lease_owner: 'worker-b' } }],
			['wrong recovery mode', { callbackClaim: { ...args.callbackClaim }, db: `UPDATE nexora_onboarding_callback_claims SET recovery_mode='REAUTHORIZATION' WHERE id='claim-1'` }],
			['wrong claim', { callbackClaim: { ...args.callbackClaim, id: 'other-claim' } }],
			['wrong session', { replacementAuthorizationSessionId: 'other-session' }],
			['wrong correlation', { replacementCorrelationId: 'other-correlation' }],
			['wrong work', { reauthorizationWorkId: 'other-work' }],
			['wrong tenant', { onboardingMissionId: mission, tenantId: 9 }],
			['wrong workspace', { onboardingMissionId: mission, workspaceId: 9 }],
			['wrong provider', { provider: 'microsoft' }],
			['wrong mission', { onboardingMissionId: 'other-mission' }],
			['wrong scope reference', { scopePlanReference: 'wrong-reference' }],
			['wrong scope digest', { scopePlanDigest: 'wrong-digest' }],
			['wrong prior checkpoint', { expectedPriorCheckpoint: 'OTHER_CHECKPOINT' }],
			['wrong generation', { expectedRotationGeneration: 9 }],
		];
		for (const [, override] of cases) {
			await reset();
			if (override.db) await env.db.prepare(override.db).run();
			const before = await fingerprint.fingerprintReplacementAuthorityState(c, { missionId: mission, ...scope });
			const callScope = { tenantId: override.tenantId ?? scope.tenantId, workspaceId: override.workspaceId ?? scope.workspaceId };
			const result = await tokenStorage.commitReauthorizationWithFence(c, callScope, { ...args, ...override });
			expect(result.committed).toBe(false);
			const after = await fingerprint.fingerprintReplacementAuthorityState(c, { missionId: mission, ...scope });
			expect(after.digest).toBe(before.digest);
		}
		await reset();
		await env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET status='CANCELLED' WHERE id='work-1'`).run();
		const cancelledBefore = await fingerprint.fingerprintReplacementAuthorityState(c, { missionId: mission, ...scope });
		const cancelled = await tokenStorage.commitReauthorizationWithFence(c, scope, args);
		expect(cancelled.committed).toBe(false);
		expect((await fingerprint.fingerprintReplacementAuthorityState(c, { missionId: mission, ...scope })).digest).toBe(cancelledBefore.digest);
		await reset();
		await env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET status='COMPLETED' WHERE id='work-1'`).run();
		const terminalWorkBefore = await fingerprint.fingerprintReplacementAuthorityState(c, { missionId: mission, ...scope });
		const terminalWork = await tokenStorage.commitReauthorizationWithFence(c, scope, args);
		expect(terminalWork.committed).toBe(false);
		expect((await fingerprint.fingerprintReplacementAuthorityState(c, { missionId: mission, ...scope })).digest).toBe(terminalWorkBefore.digest);
		await reset();
		await env.db.prepare(`UPDATE nexora_onboarding_callback_claims SET claim_status='COMPLETED' WHERE id='claim-1'`).run();
		const terminalClaimBefore = await fingerprint.fingerprintReplacementAuthorityState(c, { missionId: mission, ...scope });
		const terminalClaim = await tokenStorage.commitReauthorizationWithFence(c, scope, args);
		expect(terminalClaim.committed).toBe(false);
		expect((await fingerprint.fingerprintReplacementAuthorityState(c, { missionId: mission, ...scope })).digest).toBe(terminalClaimBefore.digest);
	});
});
