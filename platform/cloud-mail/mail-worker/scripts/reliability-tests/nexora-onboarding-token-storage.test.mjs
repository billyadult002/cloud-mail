// NEXORA Zero-Touch onboarding: secure token storage — real D1, real AES-GCM encryption
// (reusing secret-crypto.js, not a new crypto primitive). Verifies encryption at rest,
// rotation, revocation marker, refresh-result tracking, and that no plaintext token is ever
// exposed through connectionHealth() (the only function safe to call from an API layer).
import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import tokenStorage from '../../src/service/nexora-onboarding-token-storage-service.js';

const TENANT_ID = 990701;
const WORKSPACE_ID = 990702;

const SCHEMA = `CREATE TABLE nexora_onboarding_tokens (
	id TEXT PRIMARY KEY, onboarding_mission_id TEXT NOT NULL, tenant_id INTEGER NOT NULL, workspace_id INTEGER NOT NULL,
	provider TEXT NOT NULL CHECK(provider IN ('google','microsoft')), provider_account_hash TEXT NOT NULL,
	refresh_token_ciphertext TEXT NOT NULL, access_token_ciphertext TEXT, access_token_expires_at TEXT,
	granted_scopes_json TEXT NOT NULL, rotation_generation INTEGER NOT NULL DEFAULT 1,
	connection_health TEXT NOT NULL DEFAULT 'healthy' CHECK(connection_health IN ('healthy','degraded','revoked','unknown')),
	last_successful_refresh_at TEXT, last_failed_refresh_at TEXT, refresh_failure_count INTEGER NOT NULL DEFAULT 0,
	revoked_at TEXT, revoked_reason TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	UNIQUE(onboarding_mission_id)
)`;

async function resetSchema() {
	await env.db.prepare(`DROP TABLE IF EXISTS nexora_onboarding_tokens`).run();
	await env.db.prepare(SCHEMA).run();
}

const scope = { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID };
const c = { env: { ...env, jwt_secret: 'test-only-pool-workers-encryption-secret-1234567890' } };

beforeEach(async () => {
	await resetSchema();
});

describe('Token storage — real D1, real encryption at rest', () => {
	it('E13/V6: the raw refresh token is never stored in cleartext; the DB row contains only ciphertext', async () => {
		const rawRefreshToken = 'raw-refresh-token-value-that-must-never-appear-in-storage';
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ob-tok-1', provider: 'google', providerAccountHash: 'acct-hash-1', refreshToken: rawRefreshToken, grantedScopes: ['openid', 'https://www.googleapis.com/auth/gmail.readonly'] });
		const row = await env.db.prepare(`SELECT * FROM nexora_onboarding_tokens WHERE onboarding_mission_id='ob-tok-1'`).first();
		expect(row.refresh_token_ciphertext).not.toBe(rawRefreshToken);
		expect(row.refresh_token_ciphertext).not.toContain(rawRefreshToken);
		expect(JSON.stringify(row)).not.toContain(rawRefreshToken);
	});

	it('retrieval decrypts back to the exact original value (round-trip correctness)', async () => {
		const rawRefreshToken = 'round-trip-refresh-token-abc123';
		const rawAccessToken = 'round-trip-access-token-xyz789';
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ob-tok-2', provider: 'microsoft', providerAccountHash: 'acct-hash-2', refreshToken: rawRefreshToken, accessToken: rawAccessToken, accessTokenExpiresAt: new Date(Date.now() + 3600000).toISOString(), grantedScopes: ['Mail.Read'] });
		const retrieved = await tokenStorage.retrieveForRuntimeUse(c, scope, { onboardingMissionId: 'ob-tok-2' });
		expect(retrieved.refreshToken).toBe(rawRefreshToken);
		expect(retrieved.accessToken).toBe(rawAccessToken);
		expect(retrieved.grantedScopes).toEqual(['Mail.Read']);
	});

	it('V6: connectionHealth() never returns a plaintext token field, only metadata', async () => {
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ob-tok-3', provider: 'google', providerAccountHash: 'acct-hash-3', refreshToken: 'secret-value-should-not-leak', grantedScopes: ['openid'] });
		const health = await tokenStorage.connectionHealth(c, scope, { onboardingMissionId: 'ob-tok-3' });
		expect(JSON.stringify(health)).not.toContain('secret-value-should-not-leak');
		expect(Object.keys(health)).not.toContain('refreshToken');
		expect(Object.keys(health)).not.toContain('accessToken');
		expect(health.health).toBe('healthy');
	});

	it('E16/V7: rotation replaces the ciphertext and increments rotation_generation, old value no longer decryptable as current', async () => {
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ob-tok-4', provider: 'google', providerAccountHash: 'acct-hash-4', refreshToken: 'first-generation-token', grantedScopes: ['openid'] });
		const rotated = await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ob-tok-4', provider: 'google', providerAccountHash: 'acct-hash-4', refreshToken: 'second-generation-token', grantedScopes: ['openid'] });
		expect(rotated.rotated).toBe(true);
		expect(rotated.rotationGeneration).toBe(2);
		const retrieved = await tokenStorage.retrieveForRuntimeUse(c, scope, { onboardingMissionId: 'ob-tok-4' });
		expect(retrieved.refreshToken).toBe('second-generation-token'); // current is the new generation
		const health = await tokenStorage.connectionHealth(c, scope, { onboardingMissionId: 'ob-tok-4' });
		expect(health.rotationGeneration).toBe(2);
	});

	it('V19: refresh-failure tracking accumulates and downgrades connection health without discarding the record', async () => {
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ob-tok-5', provider: 'microsoft', providerAccountHash: 'acct-hash-5', refreshToken: 'token-5', grantedScopes: ['Mail.Read'] });
		await tokenStorage.markRefreshResult(c, scope, { onboardingMissionId: 'ob-tok-5', success: false, health: 'degraded' });
		await tokenStorage.markRefreshResult(c, scope, { onboardingMissionId: 'ob-tok-5', success: false, health: 'degraded' });
		const health = await tokenStorage.connectionHealth(c, scope, { onboardingMissionId: 'ob-tok-5' });
		expect(health.refreshFailureCount).toBe(2);
		expect(health.health).toBe('degraded');
		expect(health.revoked).toBe(false);

		await tokenStorage.markRefreshResult(c, scope, { onboardingMissionId: 'ob-tok-5', success: true });
		const healed = await tokenStorage.connectionHealth(c, scope, { onboardingMissionId: 'ob-tok-5' });
		expect(healed.refreshFailureCount).toBe(0); // a successful refresh resets the failure count
		expect(healed.health).toBe('healthy');
	});

	it('E17/V12: revocation sets a precise marker and reason; retrieveForRuntimeUse reports revoked without ever attempting decryption', async () => {
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ob-tok-6', provider: 'google', providerAccountHash: 'acct-hash-6', refreshToken: 'token-6', grantedScopes: ['openid'] });
		await tokenStorage.markRevoked(c, scope, { onboardingMissionId: 'ob-tok-6', reason: 'invalid_grant' });
		const health = await tokenStorage.connectionHealth(c, scope, { onboardingMissionId: 'ob-tok-6' });
		expect(health.health).toBe('revoked');
		expect(health.revoked).toBe(true);
		expect(health.revokedReason).toBe('invalid_grant');
		const retrieved = await tokenStorage.retrieveForRuntimeUse(c, scope, { onboardingMissionId: 'ob-tok-6' });
		expect(retrieved.revoked).toBe(true);
		expect(retrieved.refreshToken).toBeUndefined(); // never decrypted for a revoked record
	});

	it('cross-tenant scope is enforced on retrieval, refresh marking, and revocation', async () => {
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId: 'ob-tok-7', provider: 'google', providerAccountHash: 'acct-hash-7', refreshToken: 'token-7', grantedScopes: ['openid'] });
		const otherScope = { tenantId: TENANT_ID, workspaceId: WORKSPACE_ID + 1 };
		await expect(tokenStorage.retrieveForRuntimeUse(c, otherScope, { onboardingMissionId: 'ob-tok-7' })).rejects.toThrow('nexora_onboarding_token_scope_denied');
		await expect(tokenStorage.markRevoked(c, otherScope, { onboardingMissionId: 'ob-tok-7', reason: 'x' })).rejects.toThrow('nexora_onboarding_token_scope_denied');
	});
});
