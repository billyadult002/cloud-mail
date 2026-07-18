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
];
const TABLES = ['nexora_onboarding_tokens', 'mission_runtime_events'];

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
});
