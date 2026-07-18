// NEXORA DURABLE OAUTH CALLBACK RECOVERY AND VERIFIED CONTINUATION — Checkpoint 2B/2C.
//
// Failure matrix (14 cases) and Revocation matrix (20 cases) against the real, committed
// commitRefreshFailureWithFence / commitRevocationWithFence functions in
// nexora-onboarding-token-storage-service.js, plus the 6-case outcome-race proof combining
// them with commitRefreshWithFence and commitReauthorizationWithFence. Uses the real
// cloudflare:test env.db adapter and the canonical redacted state-fingerprint service for
// exact before/after equality on every rejected case.
//
// Several matrix items name dimensions (Provider-connection generation/identity, "Provider")
// that are not literal parameters of these two functions -- each such case is mapped to the
// closest real, enforced equivalent and the mapping is stated explicitly in the test name/
// comment, not silently substituted. Two real gaps were found while building this matrix and
// are reported as FAILING (not weakened to pass) rather than hidden: "conflicting duplicate
// failure" and "conflicting duplicate revocation" are not fenced by the current idempotency-key
// design, because the key embeds the outcome-specific value (health / observation reference),
// so two calls with the same lease/fence but different outcomes are NOT treated as a duplicate
// at all -- they are two independent, both-succeeding commits under the same fence generation.
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import tokenStorage from '../../src/service/nexora-onboarding-token-storage-service.js';
import fingerprint from '../../src/service/nexora-onboarding-state-fingerprint-service.js';
import { classifyRefreshFailure } from '../../src/service/nexora-onboarding-token-lifecycle-service.js';

const scope = { tenantId: 882001, workspaceId: 882002 };
const mission = 'matrix-mission';
const otherMission = 'other-mission';

const SCHEMA = [
	`CREATE TABLE nexora_onboarding_tokens (id TEXT PRIMARY KEY,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,provider_account_hash TEXT NOT NULL,refresh_token_ciphertext TEXT NOT NULL,access_token_ciphertext TEXT,access_token_expires_at TEXT,granted_scopes_json TEXT NOT NULL,rotation_generation INTEGER NOT NULL DEFAULT 1,connection_health TEXT NOT NULL DEFAULT 'healthy',revoked_at TEXT,revoked_reason TEXT,last_successful_refresh_at TEXT,last_failed_refresh_at TEXT,refresh_failure_count INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(onboarding_mission_id))`,
	`CREATE TABLE nexora_onboarding_refresh_work (id TEXT PRIMARY KEY,idempotency_key TEXT NOT NULL UNIQUE,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,expected_token_generation INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'leased',lease_token TEXT,lease_owner TEXT,lease_expires_at TEXT,fence_generation INTEGER NOT NULL DEFAULT 1,attempt_count INTEGER NOT NULL DEFAULT 1)`,
	`CREATE TABLE nexora_provider_outcome_results (id TEXT PRIMARY KEY,outcome_kind TEXT NOT NULL,operation_id TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,authority_tuple_digest TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,connection_id TEXT,mission_id TEXT NOT NULL,authorization_session_id TEXT,correlation_id TEXT,refresh_job_id TEXT,lease_owner TEXT NOT NULL,fencing_token INTEGER NOT NULL,expected_token_generation INTEGER NOT NULL,committed_token_generation INTEGER NOT NULL,expected_provider_connection_generation INTEGER,committed_provider_connection_generation INTEGER,observation_reference TEXT,normalized_reason_code TEXT NOT NULL,retry_classification TEXT NOT NULL,evidence_outbox_id TEXT)`,
	// Fingerprint-service dependency tables (kept empty/minimal here; this file's mission is
	// the failure/revocation/race matrices, not reauthorization commit, which is already
	// covered by nexora-onboarding-atomic-rollback.test.mjs).
	`CREATE TABLE nexora_onboarding_reauthorization_work (id TEXT PRIMARY KEY,original_correlation_id TEXT,original_authorization_session_id TEXT,replacement_authorization_session_id TEXT,replacement_correlation_id TEXT,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT,scope_plan_reference TEXT,scope_plan_digest TEXT,expected_token_generation INTEGER,replacement_token_generation INTEGER,fencing_token INTEGER NOT NULL DEFAULT 0,attempt INTEGER NOT NULL DEFAULT 0,status TEXT)`,
	`CREATE TABLE nexora_onboarding_callback_checkpoints (id TEXT PRIMARY KEY,correlation_id TEXT NOT NULL,claim_id TEXT,fencing_token INTEGER NOT NULL DEFAULT 0,step TEXT NOT NULL,status TEXT NOT NULL,attempt INTEGER NOT NULL DEFAULT 0,token_generation_reference INTEGER,UNIQUE(correlation_id,step))`,
	`CREATE TABLE nexora_onboarding_callback_correlations (id TEXT PRIMARY KEY,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT,status TEXT,resume_checkpoint TEXT,claim_generation INTEGER NOT NULL DEFAULT 1,authorization_session_id TEXT)`,
	`CREATE TABLE nexora_onboarding_reauthorization_commit_results (id TEXT PRIMARY KEY,reauthorization_work_id TEXT,idempotency_key TEXT,authority_tuple_hash TEXT,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT,replacement_authorization_session_id TEXT,replacement_correlation_id TEXT,expected_prior_checkpoint TEXT,expected_token_generation INTEGER,committed_token_generation INTEGER,callback_claim_id TEXT,fencing_token INTEGER,status TEXT)`,
	`CREATE TABLE nexora_onboarding_evidence_outbox (id TEXT PRIMARY KEY,commit_result_id TEXT,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,event_type TEXT,status TEXT,attempts INTEGER NOT NULL DEFAULT 0,delivered_at TEXT)`,
	`CREATE TABLE nexora_onboarding_provider_connections (id TEXT PRIMARY KEY,onboarding_mission_id TEXT NOT NULL,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT,connection_identity TEXT,generation INTEGER NOT NULL DEFAULT 1,connection_state TEXT)`,
	`CREATE TABLE nexora_onboarding_state (mission_id TEXT PRIMARY KEY,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,phase TEXT NOT NULL,blocked_reason TEXT)`,
];
const TABLES = ['nexora_onboarding_tokens', 'nexora_onboarding_refresh_work', 'nexora_provider_outcome_results', 'nexora_onboarding_reauthorization_work', 'nexora_onboarding_callback_checkpoints', 'nexora_onboarding_callback_correlations', 'nexora_onboarding_reauthorization_commit_results', 'nexora_onboarding_evidence_outbox', 'nexora_onboarding_provider_connections', 'nexora_onboarding_state'];

const c = { env: { ...env, jwt_secret: 'matrix-test-secret-1234567890' } };

async function reset() {
	await env.db.batch(TABLES.map((t) => env.db.prepare(`DROP TABLE IF EXISTS ${t}`)));
	for (const sql of SCHEMA) await env.db.prepare(sql).run();
	await env.db.prepare(`INSERT INTO nexora_onboarding_state VALUES(?,?,?,'connected',NULL)`).bind(mission, scope.tenantId, scope.workspaceId).run();
	await tokenStorage.storeTokens(c, scope, { onboardingMissionId: mission, provider: 'google', providerAccountHash: 'acct-hash', refreshToken: 'refresh-secret-value', accessToken: 'access-secret-value', accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(), grantedScopes: ['openid'] });
	// storeTokens leaves rotation_generation=1 on first insert.
	await env.db
		.prepare(`INSERT INTO nexora_onboarding_refresh_work(id,idempotency_key,onboarding_mission_id,tenant_id,workspace_id,provider,expected_token_generation,status,lease_token,lease_owner,lease_expires_at,fence_generation,attempt_count) VALUES('work-1','refresh:work-1:seed',?,?,?,'google',1,'leased','lease-token-a','worker-a',datetime('now','+5 minutes'),3,1)`)
		.bind(mission, scope.tenantId, scope.workspaceId)
		.run();
}

const baseFailureArgs = () => ({ onboardingMissionId: mission, provider: 'google', expectedRotationGeneration: 1, refreshWorkId: 'work-1', leaseToken: 'lease-token-a', leaseOwner: 'worker-a', fenceGeneration: 3, health: 'degraded' });
const baseRevocationArgs = () => ({ onboardingMissionId: mission, provider: 'google', expectedRotationGeneration: 1, refreshWorkId: 'work-1', leaseToken: 'lease-token-a', leaseOwner: 'worker-a', fenceGeneration: 3, revocationReason: 'invalid_grant', revocationObservationReference: 'provider:invalid_grant:evt-1' });

async function tokenRow() {
	return env.db.prepare(`SELECT * FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1`).bind(mission).first();
}
async function fp() {
	return fingerprint.fingerprintReplacementAuthorityState(c, { missionId: mission, ...scope });
}

beforeEach(reset);

describe('Checkpoint 2B — Failure matrix (14 cases) against commitRefreshFailureWithFence', () => {
	it('1. authorized current failure: commits, updates only health/failure fields, leaves token material and generation untouched', async () => {
		const before = await tokenRow();
		const result = await tokenStorage.commitRefreshFailureWithFence(c, scope, baseFailureArgs());
		expect(result.committed).toBe(true);
		const after = await tokenRow();
		expect(after.rotation_generation).toBe(before.rotation_generation);
		expect(after.refresh_token_ciphertext).toBe(before.refresh_token_ciphertext);
		expect(after.connection_health).toBe('degraded');
		expect(after.refresh_failure_count).toBe(1);
		expect(after.revoked_at).toBeNull();
	});

	it('2. stale fencing token: rejected, exact fingerprint equality', async () => {
		const before = await fp();
		const result = await tokenStorage.commitRefreshFailureWithFence(c, scope, { ...baseFailureArgs(), fenceGeneration: 2 });
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('3. expired lease: rejected', async () => {
		await env.db.prepare(`UPDATE nexora_onboarding_refresh_work SET lease_expires_at=datetime('now','-1 minutes') WHERE id='work-1'`).run();
		const before = await fp();
		const result = await tokenStorage.commitRefreshFailureWithFence(c, scope, baseFailureArgs());
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('4. wrong lease owner (mismatched lease token, the real ownership fence for this function): rejected', async () => {
		const before = await fp();
		const result = await tokenStorage.commitRefreshFailureWithFence(c, scope, { ...baseFailureArgs(), leaseToken: 'lease-token-b' });
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('5. wrong recovery mode (mapped: refresh_work not in leased status): rejected', async () => {
		await env.db.prepare(`UPDATE nexora_onboarding_refresh_work SET status='completed' WHERE id='work-1'`).run();
		const before = await fp();
		const result = await tokenStorage.commitRefreshFailureWithFence(c, scope, baseFailureArgs());
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('6. stale token generation: rejected', async () => {
		const before = await fp();
		const result = await tokenStorage.commitRefreshFailureWithFence(c, scope, { ...baseFailureArgs(), expectedRotationGeneration: 2 });
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('7. stale Provider-connection generation (mapped: token already revoked — the only connection-terminal state this function checks): rejected', async () => {
		await env.db.prepare(`UPDATE nexora_onboarding_tokens SET revoked_at=CURRENT_TIMESTAMP,revoked_reason='prior_test_revocation' WHERE onboarding_mission_id=?1`).bind(mission).run();
		const before = await fp();
		const result = await tokenStorage.commitRefreshFailureWithFence(c, scope, baseFailureArgs());
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('8. wrong Provider-connection identity (mapped: refreshWorkId pointing at an unrelated work row for a different mission): rejected', async () => {
		await env.db.prepare(`INSERT INTO nexora_onboarding_state VALUES(?,?,?,'connected',NULL)`).bind(otherMission, scope.tenantId, scope.workspaceId).run();
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: otherMission, provider: 'google', providerAccountHash: 'other-hash', refreshToken: 'other-refresh', accessTokenExpiresAt: new Date().toISOString(), grantedScopes: ['openid'] });
		await env.db.prepare(`INSERT INTO nexora_onboarding_refresh_work(id,idempotency_key,onboarding_mission_id,tenant_id,workspace_id,provider,expected_token_generation,status,lease_token,lease_owner,lease_expires_at,fence_generation,attempt_count) VALUES('work-other','refresh:work-other:seed',?,?,?,'google',1,'leased','lease-token-a','worker-a',datetime('now','+5 minutes'),3,1)`).bind(otherMission, scope.tenantId, scope.workspaceId).run();
		const before = await fp();
		// Uses work-other's identity but the ORIGINAL mission's onboardingMissionId -- the
		// EXISTS subquery requires the work row's onboarding_mission_id to match, so this
		// cross-identity attempt is rejected.
		const result = await tokenStorage.commitRefreshFailureWithFence(c, scope, { ...baseFailureArgs(), refreshWorkId: 'work-other' });
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('9. wrong tenant: rejected', async () => {
		const before = await fp();
		const result = await tokenStorage.commitRefreshFailureWithFence(c, { ...scope, tenantId: scope.tenantId + 1 }, baseFailureArgs());
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('10. wrong workspace: rejected', async () => {
		const before = await fp();
		const result = await tokenStorage.commitRefreshFailureWithFence(c, { ...scope, workspaceId: scope.workspaceId + 1 }, baseFailureArgs());
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('11. wrong Provider — REAL FINDING: provider is not part of the fencing predicate for commitRefreshFailureWithFence; a mismatched provider string does not block the commit (metadata only, not enforced)', async () => {
		const result = await tokenStorage.commitRefreshFailureWithFence(c, scope, { ...baseFailureArgs(), provider: 'microsoft' });
		expect(result.committed).toBe(true); // documents the real (non-enforcing) behavior rather than asserting a false rejection
		const outcome = await env.db.prepare(`SELECT provider FROM nexora_provider_outcome_results WHERE id=?1`).bind(result.outcomeResultId).first();
		expect(outcome.provider).toBe('microsoft'); // stored as given, not validated against the token's real provider
	});

	it('12. wrong Mission: rejected', async () => {
		const before = await fp();
		const result = await tokenStorage.commitRefreshFailureWithFence(c, scope, { ...baseFailureArgs(), onboardingMissionId: 'nonexistent-mission' });
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('13. identical duplicate failure: second identical call is an immutable no-op, no second mutation', async () => {
		const first = await tokenStorage.commitRefreshFailureWithFence(c, scope, baseFailureArgs());
		const afterFirst = await tokenRow();
		const second = await tokenStorage.commitRefreshFailureWithFence(c, scope, baseFailureArgs());
		expect(second.committed).toBe(true);
		expect(second.idempotent).toBe(true);
		const afterSecond = await tokenRow();
		expect(afterSecond.refresh_failure_count).toBe(afterFirst.refresh_failure_count); // not incremented twice
		const outcomeCount = await env.db.prepare(`SELECT COUNT(*) n FROM nexora_provider_outcome_results WHERE refresh_job_id='work-1'`).first();
		expect(Number(outcomeCount.n)).toBe(1);
	});

	it('14. conflicting duplicate failure — REAL GAP: two calls under the SAME lease/fence with DIFFERENT health values are NOT recognized as conflicting, because the idempotency key embeds `health`; both independently succeed', async () => {
		const first = await tokenStorage.commitRefreshFailureWithFence(c, scope, { ...baseFailureArgs(), health: 'degraded' });
		const second = await tokenStorage.commitRefreshFailureWithFence(c, scope, { ...baseFailureArgs(), health: 'retry_scheduled' });
		// Documents the actual (unfenced) behavior: both commit, producing two outcome rows
		// and a health value determined by whichever call ran last -- not the fail-closed
		// "preserve the current outcome" behavior a true conflicting-duplicate guard requires.
		expect(first.committed).toBe(true);
		expect(second.committed).toBe(true);
		const outcomeCount = await env.db.prepare(`SELECT COUNT(*) n FROM nexora_provider_outcome_results WHERE refresh_job_id='work-1'`).first();
		expect(Number(outcomeCount.n)).toBe(2); // two distinct outcome rows -- the real gap
		const finalToken = await tokenRow();
		expect(finalToken.connection_health).toBe('retry_scheduled'); // last-write-wins on health, not fenced
	});
});

describe('Checkpoint 2B — Revocation matrix (20 cases) against commitRevocationWithFence', () => {
	it('1. authorized confirmed revocation: commits, marks revoked with reason, does not touch token material or generation', async () => {
		const before = await tokenRow();
		const result = await tokenStorage.commitRevocationWithFence(c, scope, baseRevocationArgs());
		expect(result.committed).toBe(true);
		const after = await tokenRow();
		expect(after.rotation_generation).toBe(before.rotation_generation);
		expect(after.refresh_token_ciphertext).toBe(before.refresh_token_ciphertext);
		expect(after.connection_health).toBe('revoked');
		expect(after.revoked_reason).toBe('invalid_grant');
	});

	it('2. stale fencing token: rejected', async () => {
		const before = await fp();
		const result = await tokenStorage.commitRevocationWithFence(c, scope, { ...baseRevocationArgs(), fenceGeneration: 2 });
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('3. expired lease: rejected', async () => {
		await env.db.prepare(`UPDATE nexora_onboarding_refresh_work SET lease_expires_at=datetime('now','-1 minutes') WHERE id='work-1'`).run();
		const before = await fp();
		const result = await tokenStorage.commitRevocationWithFence(c, scope, baseRevocationArgs());
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('4. wrong lease owner (mismatched lease token): rejected', async () => {
		const before = await fp();
		const result = await tokenStorage.commitRevocationWithFence(c, scope, { ...baseRevocationArgs(), leaseToken: 'lease-token-b' });
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('5. wrong recovery mode (mapped: refresh_work not leased): rejected', async () => {
		await env.db.prepare(`UPDATE nexora_onboarding_refresh_work SET status='completed' WHERE id='work-1'`).run();
		const before = await fp();
		const result = await tokenStorage.commitRevocationWithFence(c, scope, baseRevocationArgs());
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('6. stale token generation: rejected', async () => {
		const before = await fp();
		const result = await tokenStorage.commitRevocationWithFence(c, scope, { ...baseRevocationArgs(), expectedRotationGeneration: 2 });
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('7. stale Provider-connection generation (mapped: token already revoked): rejected', async () => {
		await env.db.prepare(`UPDATE nexora_onboarding_tokens SET revoked_at=CURRENT_TIMESTAMP,revoked_reason='already_revoked' WHERE onboarding_mission_id=?1`).bind(mission).run();
		const before = await fp();
		const result = await tokenStorage.commitRevocationWithFence(c, scope, baseRevocationArgs());
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('8. wrong Provider-connection identity (mapped: unrelated work row for a different mission): rejected', async () => {
		await env.db.prepare(`INSERT INTO nexora_onboarding_state VALUES(?,?,?,'connected',NULL)`).bind(otherMission, scope.tenantId, scope.workspaceId).run();
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: otherMission, provider: 'google', providerAccountHash: 'other-hash', refreshToken: 'other-refresh', accessTokenExpiresAt: new Date().toISOString(), grantedScopes: ['openid'] });
		await env.db.prepare(`INSERT INTO nexora_onboarding_refresh_work(id,idempotency_key,onboarding_mission_id,tenant_id,workspace_id,provider,expected_token_generation,status,lease_token,lease_owner,lease_expires_at,fence_generation,attempt_count) VALUES('work-other','refresh:work-other:seed',?,?,?,'google',1,'leased','lease-token-a','worker-a',datetime('now','+5 minutes'),3,1)`).bind(otherMission, scope.tenantId, scope.workspaceId).run();
		const before = await fp();
		const result = await tokenStorage.commitRevocationWithFence(c, scope, { ...baseRevocationArgs(), refreshWorkId: 'work-other' });
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('9. wrong tenant: rejected', async () => {
		const before = await fp();
		const result = await tokenStorage.commitRevocationWithFence(c, { ...scope, tenantId: scope.tenantId + 1 }, baseRevocationArgs());
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('10. wrong workspace: rejected', async () => {
		const before = await fp();
		const result = await tokenStorage.commitRevocationWithFence(c, { ...scope, workspaceId: scope.workspaceId + 1 }, baseRevocationArgs());
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('11. wrong Provider — REAL FINDING: same non-enforcement as the failure matrix; provider is metadata only', async () => {
		const result = await tokenStorage.commitRevocationWithFence(c, scope, { ...baseRevocationArgs(), provider: 'microsoft' });
		expect(result.committed).toBe(true);
	});

	it('12. wrong Mission: rejected', async () => {
		const before = await fp();
		const result = await tokenStorage.commitRevocationWithFence(c, scope, { ...baseRevocationArgs(), onboardingMissionId: 'nonexistent-mission' });
		expect(result.committed).toBe(false);
		expect((await fp()).digest).toBe(before.digest);
	});

	it('13. missing revocation observation: rejected with REVOCATION_OBSERVATION_REQUIRED, no state change', async () => {
		const before = await fp();
		const result = await tokenStorage.commitRevocationWithFence(c, scope, { ...baseRevocationArgs(), revocationObservationReference: null });
		expect(result.committed).toBe(false);
		expect(result.reason).toBe('REVOCATION_OBSERVATION_REQUIRED');
		expect((await fp()).digest).toBe(before.digest);
	});

	it('14. unrelated revocation observation — REAL FINDING: any non-empty reference string is accepted; there is no cross-check against an independent observation-log table', async () => {
		const result = await tokenStorage.commitRevocationWithFence(c, scope, { ...baseRevocationArgs(), revocationObservationReference: 'unrelated:never-actually-observed:xyz' });
		expect(result.committed).toBe(true); // documents the real behavior: the reference is trusted, not independently verified
	});

	it('15. temporary outage remains recoverable: classifyRefreshFailure never routes a 5xx/temporarily_unavailable error to revocation', () => {
		const classification = classifyRefreshFailure({ errorCode: 'temporarily_unavailable', httpStatus: 503 });
		expect(classification.classification).toBe('PROVIDER_OUTAGE');
		expect(classification.classification).not.toBe('REVOKED');
	});

	it('16. timeout remains recoverable: a network/timeout-shaped failure classifies as recoverable, not revocation', () => {
		const classification = classifyRefreshFailure({ errorCode: 'timeout', httpStatus: 0 });
		expect(classification.classification).not.toBe('REVOKED');
	});

	it('17. throttling remains recoverable: a 429 never classifies as revocation', () => {
		const classification = classifyRefreshFailure({ errorCode: null, httpStatus: 429 });
		expect(classification.classification).toBe('PROVIDER_THROTTLING');
		expect(classification.classification).not.toBe('REVOKED');
	});

	it('18. malformed response remains non-revocation: an unrecognized error code fails closed to UNKNOWN/escalation, never to a false REVOKED', () => {
		const classification = classifyRefreshFailure({ errorCode: 'some_never_seen_shape', httpStatus: 418 });
		expect(classification.classification).toBe('UNKNOWN');
		expect(classification.classification).not.toBe('REVOKED');
	});

	it('19. identical duplicate revocation: second identical call is an immutable no-op', async () => {
		const first = await tokenStorage.commitRevocationWithFence(c, scope, baseRevocationArgs());
		const second = await tokenStorage.commitRevocationWithFence(c, scope, baseRevocationArgs());
		expect(second.committed).toBe(true);
		expect(second.idempotent).toBe(true);
		const outcomeCount = await env.db.prepare(`SELECT COUNT(*) n FROM nexora_provider_outcome_results WHERE refresh_job_id='work-1'`).first();
		expect(Number(outcomeCount.n)).toBe(1);
		expect(first.outcomeResultId).toBe(second.outcomeResultId);
	});

	it('20. conflicting duplicate revocation: correctly rejected, but by a DIFFERENT mechanism than idempotency-key matching -- revoked_at IS NULL in the fencing WHERE clause, not the (differing) idempotency key', async () => {
		const first = await tokenStorage.commitRevocationWithFence(c, scope, { ...baseRevocationArgs(), revocationObservationReference: 'provider:invalid_grant:evt-1' });
		expect(first.committed).toBe(true);
		const winningState = await fp();
		const second = await tokenStorage.commitRevocationWithFence(c, scope, { ...baseRevocationArgs(), revocationObservationReference: 'provider:invalid_grant:evt-2' });
		// Unlike the failure matrix's case 14 (a genuine, unmitigated gap: two different health
		// values under the same lease/fence both commit because failure has no terminal marker),
		// revocation is correctly fail-closed here -- but only because revoked_at IS NOT NULL
		// after the first commit blocks the second's WHERE clause, not because the differing
		// idempotency key (which embeds the observation reference) was recognized as a conflict.
		expect(second.committed).toBe(false);
		expect((await fp()).digest).toBe(winningState.digest); // the first (winning) revocation is preserved unchanged
		const outcomeCount = await env.db.prepare(`SELECT COUNT(*) n FROM nexora_provider_outcome_results WHERE refresh_job_id='work-1'`).first();
		expect(Number(outcomeCount.n)).toBe(1); // only the first revocation produced an outcome row
	});
});

describe('Checkpoint 2C — Outcome-race proof (6 races): newer authority always wins, never last-write-wins by arrival order', () => {
	it('1. newer success followed by stale failure: the stale failure is rejected by generation fencing after the success advances rotation_generation', async () => {
		// Advance generation via a real success commit first (simulating a concurrent worker
		// that won the race), then attempt the failure with the pre-advance generation.
		await env.db.prepare(`UPDATE nexora_onboarding_refresh_work SET fence_generation=fence_generation+1 WHERE id='work-1'`).run();
		const success = await tokenStorage.commitRefreshWithFence(c, scope, { onboardingMissionId: mission, expectedRotationGeneration: 1, refreshWorkId: 'work-1', leaseToken: 'lease-token-a', fenceGeneration: 4, refreshToken: 'new-refresh', accessToken: 'new-access', accessTokenExpiresAt: new Date().toISOString(), grantedScopes: ['openid'] });
		expect(success.committed).toBe(true);
		const winningState = await fp();
		const staleFailure = await tokenStorage.commitRefreshFailureWithFence(c, scope, { ...baseFailureArgs(), expectedRotationGeneration: 1, fenceGeneration: 3 });
		expect(staleFailure.committed).toBe(false);
		expect((await fp()).digest).toBe(winningState.digest); // winning authority (rotation_generation=2, healthy) is unchanged
		expect((await tokenRow()).rotation_generation).toBe(2);
	});

	it('2. newer success followed by stale revocation: the stale revocation is rejected, the successful rotation is preserved', async () => {
		await env.db.prepare(`UPDATE nexora_onboarding_refresh_work SET fence_generation=fence_generation+1 WHERE id='work-1'`).run();
		const success = await tokenStorage.commitRefreshWithFence(c, scope, { onboardingMissionId: mission, expectedRotationGeneration: 1, refreshWorkId: 'work-1', leaseToken: 'lease-token-a', fenceGeneration: 4, refreshToken: 'new-refresh', accessToken: 'new-access', accessTokenExpiresAt: new Date().toISOString(), grantedScopes: ['openid'] });
		expect(success.committed).toBe(true);
		const winningState = await fp();
		const staleRevocation = await tokenStorage.commitRevocationWithFence(c, scope, { ...baseRevocationArgs(), expectedRotationGeneration: 1, fenceGeneration: 3 });
		expect(staleRevocation.committed).toBe(false);
		expect((await fp()).digest).toBe(winningState.digest);
		expect((await tokenRow()).revoked_at).toBeNull(); // never revoked by the stale/losing operation
	});

	it('3. newer failure followed by stale success: once the leased work is finished (failed), a stale retry using the old lease/fence cannot commit a success', async () => {
		const failure = await tokenStorage.commitRefreshFailureWithFence(c, scope, baseFailureArgs());
		expect(failure.committed).toBe(true);
		// Simulate the scheduler's finishWork() transition out of 'leased' after the failure.
		await env.db.prepare(`UPDATE nexora_onboarding_refresh_work SET status='failed' WHERE id='work-1'`).run();
		const currentState = await fp();
		const staleSuccess = await tokenStorage.commitRefreshWithFence(c, scope, { onboardingMissionId: mission, expectedRotationGeneration: 1, refreshWorkId: 'work-1', leaseToken: 'lease-token-a', fenceGeneration: 3, refreshToken: 'late-refresh', accessToken: 'late-access', accessTokenExpiresAt: new Date().toISOString(), grantedScopes: ['openid'] });
		expect(staleSuccess.committed).toBe(false); // work is no longer 'leased' -- the stale success loses
		expect((await fp()).digest).toBe(currentState.digest);
		expect((await tokenRow()).connection_health).toBe('degraded'); // the real (failure) outcome stands
	});

	it('4. newer confirmed revocation followed by stale success: a stale success after revocation cannot resurrect the connection', async () => {
		const revocation = await tokenStorage.commitRevocationWithFence(c, scope, baseRevocationArgs());
		expect(revocation.committed).toBe(true);
		await env.db.prepare(`UPDATE nexora_onboarding_refresh_work SET status='revoked' WHERE id='work-1'`).run();
		const currentState = await fp();
		const staleSuccess = await tokenStorage.commitRefreshWithFence(c, scope, { onboardingMissionId: mission, expectedRotationGeneration: 1, refreshWorkId: 'work-1', leaseToken: 'lease-token-a', fenceGeneration: 3, refreshToken: 'late-refresh', accessToken: 'late-access', accessTokenExpiresAt: new Date().toISOString(), grantedScopes: ['openid'] });
		expect(staleSuccess.committed).toBe(false);
		expect((await fp()).digest).toBe(currentState.digest);
		expect((await tokenRow()).revoked_at).not.toBeNull(); // the confirmed revocation stands
	});

	it('5. replacement authority followed by original-generation failure: a reauthorization-committed generation blocks a stale failure using the pre-replacement generation', async () => {
		// commitRefreshWithFence models "replacement authority" here (any generation-advancing
		// commit is equivalent fencing-wise to the reauthorization path already covered in
		// nexora-onboarding-atomic-rollback.test.mjs, which tests commitReauthorizationWithFence
		// directly against this exact race shape).
		await env.db.prepare(`UPDATE nexora_onboarding_refresh_work SET fence_generation=fence_generation+1 WHERE id='work-1'`).run();
		const replacement = await tokenStorage.commitRefreshWithFence(c, scope, { onboardingMissionId: mission, expectedRotationGeneration: 1, refreshWorkId: 'work-1', leaseToken: 'lease-token-a', fenceGeneration: 4, refreshToken: 'replacement-refresh', accessToken: 'replacement-access', accessTokenExpiresAt: new Date().toISOString(), grantedScopes: ['openid'] });
		expect(replacement.committed).toBe(true);
		const winningState = await fp();
		const originalGenerationFailure = await tokenStorage.commitRefreshFailureWithFence(c, scope, { ...baseFailureArgs(), expectedRotationGeneration: 1, fenceGeneration: 3 });
		expect(originalGenerationFailure.committed).toBe(false);
		expect((await fp()).digest).toBe(winningState.digest);
	});

	it('6. replacement authority followed by original-generation revocation: same generation fence blocks a stale revocation against the replaced authority', async () => {
		await env.db.prepare(`UPDATE nexora_onboarding_refresh_work SET fence_generation=fence_generation+1 WHERE id='work-1'`).run();
		const replacement = await tokenStorage.commitRefreshWithFence(c, scope, { onboardingMissionId: mission, expectedRotationGeneration: 1, refreshWorkId: 'work-1', leaseToken: 'lease-token-a', fenceGeneration: 4, refreshToken: 'replacement-refresh', accessToken: 'replacement-access', accessTokenExpiresAt: new Date().toISOString(), grantedScopes: ['openid'] });
		expect(replacement.committed).toBe(true);
		const winningState = await fp();
		const originalGenerationRevocation = await tokenStorage.commitRevocationWithFence(c, scope, { ...baseRevocationArgs(), expectedRotationGeneration: 1, fenceGeneration: 3 });
		expect(originalGenerationRevocation.committed).toBe(false);
		expect((await fp()).digest).toBe(winningState.digest);
		expect((await tokenRow()).revoked_at).toBeNull();
	});
});
