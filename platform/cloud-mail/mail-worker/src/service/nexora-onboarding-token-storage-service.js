// NEXORA Zero-Touch onboarding: secure token lifecycle storage (Required Output #11).
// Reuses the existing AES-GCM-at-rest encryption already used for the Gmail App Password path
// (secret-crypto.js) rather than inventing a second credential-storage mechanism. The raw
// refresh/access token is decrypted only inside retrieveForRuntimeUse() -- every other
// function here operates on health/metadata only and never touches plaintext.
import { encryptSecret, decryptSecret } from '../utils/secret-crypto.js';

const uuid = () => crypto.randomUUID();
function assertScope(row, scope) {
	if (!row || Number(row.tenant_id) !== Number(scope.tenantId) || Number(row.workspace_id) !== Number(scope.workspaceId)) throw new Error('nexora_onboarding_token_scope_denied');
}

async function storeTokens(c, scope, { onboardingMissionId, provider, providerAccountHash, refreshToken, accessToken = null, accessTokenExpiresAt = null, grantedScopes }) {
	const existing = await c.env.db.prepare(`SELECT rotation_generation FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1`).bind(onboardingMissionId).first();
	const refreshTokenCiphertext = await encryptSecret(c, refreshToken);
	const accessTokenCiphertext = accessToken ? await encryptSecret(c, accessToken) : null;
	if (existing) {
		await c.env.db
			.prepare(`UPDATE nexora_onboarding_tokens SET refresh_token_ciphertext=?2,access_token_ciphertext=?3,access_token_expires_at=?4,granted_scopes_json=?5,rotation_generation=rotation_generation+1,connection_health='healthy',revoked_at=NULL,revoked_reason=NULL,refresh_failure_count=0,updated_at=CURRENT_TIMESTAMP WHERE onboarding_mission_id=?1`)
			.bind(onboardingMissionId, refreshTokenCiphertext, accessTokenCiphertext, accessTokenExpiresAt, JSON.stringify(grantedScopes))
			.run();
		return { rotated: true, rotationGeneration: existing.rotation_generation + 1 };
	}
	await c.env.db
		.prepare(`INSERT INTO nexora_onboarding_tokens(id,onboarding_mission_id,tenant_id,workspace_id,provider,provider_account_hash,refresh_token_ciphertext,access_token_ciphertext,access_token_expires_at,granted_scopes_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`)
		.bind(uuid(), onboardingMissionId, scope.tenantId, scope.workspaceId, provider, providerAccountHash, refreshTokenCiphertext, accessTokenCiphertext, accessTokenExpiresAt, JSON.stringify(grantedScopes))
		.run();
	return { rotated: false, rotationGeneration: 1 };
}

// The ONLY function in this module that ever returns plaintext -- intended for the internal
// token-refresh HTTP call site only, never for an API response.
async function retrieveForRuntimeUse(c, scope, { onboardingMissionId }) {
	const row = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1`).bind(onboardingMissionId).first();
	assertScope(row, scope);
	if (!row) return null;
	if (row.revoked_at) return { revoked: true };
	return {
		revoked: false,
		refreshToken: await decryptSecret(c, row.refresh_token_ciphertext),
		accessToken: row.access_token_ciphertext ? await decryptSecret(c, row.access_token_ciphertext) : null,
		accessTokenExpiresAt: row.access_token_expires_at,
		grantedScopes: JSON.parse(row.granted_scopes_json || '[]'),
	};
}

async function connectionHealth(c, scope, { onboardingMissionId }) {
	const row = await c.env.db.prepare(`SELECT provider,connection_health,last_successful_refresh_at,last_failed_refresh_at,refresh_failure_count,revoked_at,revoked_reason,rotation_generation,access_token_expires_at,granted_scopes_json FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(onboardingMissionId, scope.tenantId, scope.workspaceId).first();
	if (!row) return { exists: false };
	return {
		exists: true,
		provider: row.provider,
		health: row.connection_health,
		lastSuccessfulRefreshAt: row.last_successful_refresh_at,
		lastFailedRefreshAt: row.last_failed_refresh_at,
		refreshFailureCount: row.refresh_failure_count,
		revoked: Boolean(row.revoked_at),
		revokedReason: row.revoked_reason,
		rotationGeneration: row.rotation_generation,
		accessTokenExpiresAt: row.access_token_expires_at,
		grantedScopes: JSON.parse(row.granted_scopes_json || '[]'),
	};
}

async function markRefreshResult(c, scope, { onboardingMissionId, success, health = null }) {
	const row = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1`).bind(onboardingMissionId).first();
	assertScope(row, scope);
	if (success) {
		await c.env.db.prepare(`UPDATE nexora_onboarding_tokens SET last_successful_refresh_at=CURRENT_TIMESTAMP,refresh_failure_count=0,connection_health='healthy',updated_at=CURRENT_TIMESTAMP WHERE onboarding_mission_id=?1`).bind(onboardingMissionId).run();
		return { health: 'healthy' };
	}
	const nextHealth = health || 'degraded';
	await c.env.db.prepare(`UPDATE nexora_onboarding_tokens SET last_failed_refresh_at=CURRENT_TIMESTAMP,refresh_failure_count=refresh_failure_count+1,connection_health=?2,updated_at=CURRENT_TIMESTAMP WHERE onboarding_mission_id=?1`).bind(onboardingMissionId, nextHealth).run();
	return { health: nextHealth };
}

async function markRevoked(c, scope, { onboardingMissionId, reason }) {
	const row = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1`).bind(onboardingMissionId).first();
	assertScope(row, scope);
	await c.env.db.prepare(`UPDATE nexora_onboarding_tokens SET connection_health='revoked',revoked_at=CURRENT_TIMESTAMP,revoked_reason=?2,updated_at=CURRENT_TIMESTAMP WHERE onboarding_mission_id=?1`).bind(onboardingMissionId, reason).run();
	return { health: 'revoked' };
}

export default { storeTokens, retrieveForRuntimeUse, connectionHealth, markRefreshResult, markRevoked };
