// NEXORA Zero-Touch onboarding: scheduled token refresh orchestration — real D1 + deterministic
// fixture token-exchange responses (no live network).
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import refreshScheduler from '../../src/service/nexora-onboarding-refresh-scheduler-service.js';
import tokenStorage from '../../src/service/nexora-onboarding-token-storage-service.js';

const TENANT_ID = 991101;
const WORKSPACE_ID = 991102;

const SCHEMA = [
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
	`CREATE TABLE mission_runtime_events (
		id TEXT PRIMARY KEY, mission_id TEXT NOT NULL, run_id TEXT, step_id TEXT, action_id TEXT,
		tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, event_type TEXT NOT NULL,
		from_state TEXT, to_state TEXT, expected_version INTEGER, fencing_token INTEGER,
		detail_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE nexora_onboarding_refresh_work (
		id TEXT PRIMARY KEY, idempotency_key TEXT NOT NULL UNIQUE, onboarding_mission_id TEXT NOT NULL,
		tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL, provider TEXT NOT NULL, expected_token_generation INTEGER NOT NULL,
		status TEXT NOT NULL DEFAULT 'pending', lease_token TEXT, lease_owner TEXT, lease_acquired_at TEXT, lease_expires_at TEXT, fence_generation INTEGER NOT NULL DEFAULT 0,
		attempt_count INTEGER NOT NULL DEFAULT 0, last_error_classification TEXT, completed_at TEXT,
		created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
	)`,
	`CREATE TABLE nexora_provider_outcome_results (id TEXT PRIMARY KEY,outcome_kind TEXT NOT NULL,operation_id TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,authority_tuple_digest TEXT NOT NULL,outcome_digest TEXT,tenant_id INTEGER NOT NULL,workspace_id INTEGER NOT NULL,provider TEXT NOT NULL,mission_id TEXT NOT NULL,refresh_job_id TEXT,lease_owner TEXT NOT NULL,fencing_token INTEGER NOT NULL,expected_token_generation INTEGER NOT NULL,committed_token_generation INTEGER NOT NULL,expected_provider_connection_generation INTEGER,observation_reference TEXT,normalized_reason_code TEXT NOT NULL,retry_classification TEXT NOT NULL)`,
];
const TABLES = ['nexora_onboarding_refresh_work', 'nexora_onboarding_tokens', 'mission_runtime_events', 'nexora_provider_outcome_results'];

async function resetSchema() {
	await env.db.batch(TABLES.map((t) => env.db.prepare(`DROP TABLE IF EXISTS ${t}`)));
	for (const sql of SCHEMA) await env.db.prepare(sql).run();
}

const scope = { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID };
const c = { env: { ...env, jwt_secret: 'test-only-pool-workers-encryption-secret', NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'test-client-id' } };

beforeEach(async () => {
	await resetSchema();
});

describe('Scheduled token refresh — real D1, deterministic fixture exchange responses', () => {
	it('a token expiring soon is refreshed, rotates its ciphertext, and health returns to healthy', async () => {
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ref-1', provider: 'google', providerAccountHash: 'acct-1', refreshToken: 'old-refresh', accessTokenExpiresAt: new Date(Date.now() + 60000).toISOString(), grantedScopes: ['openid'] });
		const fetchImpl = async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'new-access', expires_in: 3600, scope: 'openid' }) });
		const result = await refreshScheduler.runScheduledRefresh({ env: c.env }, { fetchImpl });
		expect(result.checked).toBe(1);
		expect(result.refreshed).toBe(1);
		const health = await tokenStorage.connectionHealth(c, scope, { onboardingMissionId: 'ref-1' });
		expect(health.health).toBe('healthy');
		expect(health.rotationGeneration).toBe(2);
	});

	it('a healthy, far-from-expiry token is not touched (bounded, not a full rescan every tick)', async () => {
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ref-2', provider: 'google', providerAccountHash: 'acct-2', refreshToken: 'refresh-2', accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(), grantedScopes: ['openid'] });
		const result = await refreshScheduler.runScheduledRefresh({ env: c.env }, { fetchImpl: async () => { throw new Error('should not be called'); } });
		expect(result.checked).toBe(0);
	});

	it('V12: a revoked-consent refresh failure (invalid_grant) marks the token revoked, not just "failed"', async () => {
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ref-3', provider: 'google', providerAccountHash: 'acct-3', refreshToken: 'refresh-3', accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(), grantedScopes: ['openid'] });
		const fetchImpl = async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant', error_description: 'revoked' }) });
		const result = await refreshScheduler.runScheduledRefresh({ env: c.env }, { fetchImpl });
		expect(result.revoked).toBe(1);
		const health = await tokenStorage.connectionHealth(c, scope, { onboardingMissionId: 'ref-3' });
		expect(health.health).toBe('revoked');
		expect(health.revokedReason).toBe('invalid_grant');
	});

	it('V19: a provider outage during refresh preserves recoverable (degraded) state, not revoked or permanently failed', async () => {
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ref-4', provider: 'google', providerAccountHash: 'acct-4', refreshToken: 'refresh-4', accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(), grantedScopes: ['openid'] });
		const fetchImpl = async () => ({ ok: false, status: 503, json: async () => ({ error: 'temporarily_unavailable' }) });
		const result = await refreshScheduler.runScheduledRefresh({ env: c.env }, { fetchImpl });
		expect(result.failed).toBe(1);
		const health = await tokenStorage.connectionHealth(c, scope, { onboardingMissionId: 'ref-4' });
		expect(health.health).toBe('degraded');
		expect(health.revoked).toBe(false); // still recoverable, not written off
	});

	it('a revoked token is skipped entirely, never attempts a refresh call', async () => {
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ref-5', provider: 'google', providerAccountHash: 'acct-5', refreshToken: 'refresh-5', accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(), grantedScopes: ['openid'] });
		await tokenStorage.markRevoked(c, scope, { onboardingMissionId: 'ref-5', reason: 'manual_test_revoke' });
		const result = await refreshScheduler.runScheduledRefresh({ env: c.env }, { fetchImpl: async () => { throw new Error('should not be called for a revoked token'); } });
		expect(result.checked).toBe(0); // dueForRefresh excludes revoked_at IS NOT NULL rows
	});

	it('fences a stale refresh result instead of overwriting a newer token rotation', async () => {
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ref-fence', provider: 'google', providerAccountHash: 'acct-fence', refreshToken: 'old', accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(), grantedScopes: ['openid'] });
		const fetchImpl = async () => {
			await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ref-fence', provider: 'google', providerAccountHash: 'acct-fence', refreshToken: 'newer', accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(), grantedScopes: ['openid'] });
			return { ok: true, status: 200, json: async () => ({ access_token: 'late-access', expires_in: 3600, scope: 'openid' }) };
		};
		const result = await refreshScheduler.runScheduledRefresh({ env: c.env }, { fetchImpl });
		expect(result.results[0].outcome).toBe('fenced');
		const health = await tokenStorage.connectionHealth(c, scope, { onboardingMissionId: 'ref-fence' });
		expect(health.rotationGeneration).toBe(2);
	});

	it('rejects stale leased work before making a provider refresh call', async () => {
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ref-preflight-fence', provider: 'google', providerAccountHash: 'acct-preflight-fence', refreshToken: 'old', accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(), grantedScopes: ['openid'] });
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ref-preflight-fence', provider: 'google', providerAccountHash: 'acct-preflight-fence', refreshToken: 'newer', accessTokenExpiresAt: new Date(Date.now() - 1000).toISOString(), grantedScopes: ['openid'] });
		await env.db
			.prepare(`INSERT INTO nexora_onboarding_refresh_work(id,idempotency_key,onboarding_mission_id,tenant_id,workspace_id,provider,expected_token_generation,status,lease_token,lease_expires_at,attempt_count) VALUES('work-stale','refresh:ref-preflight-fence:1','ref-preflight-fence',?1,?2,'google',1,'leased','lease-stale',datetime('now','+5 minutes'),1)`)
			.bind(TENANT_ID, WORKSPACE_ID)
			.run();

		const outcome = await refreshScheduler.refreshOne(c, scope, {
			id: 'work-stale',
			onboarding_mission_id: 'ref-preflight-fence',
			provider: 'google',
			expected_token_generation: 1,
			lease_token: 'lease-stale',
			attempt_count: 1,
		}, async () => {
			throw new Error('stale work must not call provider');
		});

		expect(outcome.outcome).toBe('fenced');
		const work = await env.db.prepare(`SELECT status,last_error_classification FROM nexora_onboarding_refresh_work WHERE id='work-stale'`).first();
		expect(work.status).toBe('failed');
		expect(work.last_error_classification).toBe('FENCE_REJECTED_BEFORE_PROVIDER_CALL');
	});

	it('guarded failure and revocation paths reject stale leases and preserve token generation', async () => {
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'guarded-outcomes', provider: 'google', providerAccountHash: 'acct', refreshToken: 'secret', grantedScopes: ['openid'] });
		await env.db.prepare(`INSERT INTO nexora_onboarding_refresh_work(id,idempotency_key,onboarding_mission_id,tenant_id,workspace_id,provider,expected_token_generation,status,lease_token,lease_owner,lease_expires_at,fence_generation,attempt_count) VALUES('guarded-work','guarded:1','guarded-outcomes',?1,?2,'google',1,'leased','lease-1','worker-1',datetime('now','+5 minutes'),3,1)`).bind(TENANT_ID, WORKSPACE_ID).run();
		const failure = await tokenStorage.commitRefreshFailureWithFence(c, scope, { onboardingMissionId: 'guarded-outcomes', expectedRotationGeneration: 1, refreshWorkId: 'guarded-work', leaseToken: 'lease-1', fenceGeneration: 3, health: 'degraded' });
		expect(failure.committed, failure.failureDetail || JSON.stringify(failure)).toBe(true);
		const rejectedFailure = await tokenStorage.commitRefreshFailureWithFence(c, scope, { onboardingMissionId: 'guarded-outcomes', expectedRotationGeneration: 1, refreshWorkId: 'guarded-work', leaseToken: 'wrong', fenceGeneration: 3, health: 'degraded' });
		expect(rejectedFailure.committed).toBe(false);
		const rejectedRevocation = await tokenStorage.commitRevocationWithFence(c, scope, { onboardingMissionId: 'guarded-outcomes', expectedRotationGeneration: 1, refreshWorkId: 'guarded-work', leaseToken: 'wrong', fenceGeneration: 3, revocationReason: 'invalid_grant', revocationObservationReference: 'provider:invalid_grant' });
		expect(rejectedRevocation.committed).toBe(false);
		const row = await env.db.prepare(`SELECT rotation_generation,connection_health,revoked_at FROM nexora_onboarding_tokens WHERE onboarding_mission_id='guarded-outcomes'`).first();
		expect(row.rotation_generation).toBe(1);
		expect(row.connection_health).toBe('degraded');
		expect(row.revoked_at).toBeNull();
	});
});
