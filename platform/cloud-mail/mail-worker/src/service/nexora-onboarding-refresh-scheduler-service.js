// NEXORA Zero-Touch onboarding: scheduled token refresh orchestration (Required Output #13,
// remaining Checkpoint 2 gap). Ties together nexora-onboarding-token-lifecycle-service
// (classification), nexora-onboarding-token-exchange-service (the real refresh_token grant
// HTTP call), and nexora-onboarding-token-storage-service (encrypted persistence + health
// tracking) into one bounded scheduled batch, mirroring nexora-onboarding-sync-service's
// claim/lease discipline so this is restart-safe by the same construction.
import tokenExchange from './nexora-onboarding-token-exchange-service.js';
import tokenStorage from './nexora-onboarding-token-storage-service.js';
import tokenLifecycle, { classifyTokenHealth, classifyRefreshFailure } from './nexora-onboarding-token-lifecycle-service.js';

// Finds tokens that are expiring soon (or already expired-but-refreshable) and not already
// revoked, bounded to `limit` per invocation -- never a full-table scan on every tick.
async function dueForRefresh(env, { limit = 10 } = {}) {
	const rows = await env.db.prepare(`SELECT onboarding_mission_id,tenant_id,workspace_id,provider,access_token_expires_at,revoked_at FROM nexora_onboarding_tokens WHERE revoked_at IS NULL ORDER BY access_token_expires_at LIMIT ?1`).bind(limit).all();
	const due = [];
	for (const row of rows.results || []) {
		const health = classifyTokenHealth({ expiresAt: row.access_token_expires_at, hasRefreshToken: true });
		if (health.health === 'expiring_soon' || health.health === 'expired_refreshable') due.push(row);
	}
	return due;
}

async function refreshOne(c, scope, { onboardingMissionId, provider }, fetchImpl) {
	const stored = await tokenStorage.retrieveForRuntimeUse(c, scope, { onboardingMissionId });
	if (!stored || stored.revoked) return { onboardingMissionId, outcome: 'skipped_revoked' };

	const result = await tokenExchange.refreshAccessToken(c.env, { provider, refreshToken: stored.refreshToken }, fetchImpl);
	if (result.ok) {
		await tokenStorage.storeTokens(c, scope, { onboardingMissionId, provider, providerAccountHash: (await c.env.db.prepare(`SELECT provider_account_hash FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1`).bind(onboardingMissionId).first())?.provider_account_hash || '', refreshToken: result.refreshToken || stored.refreshToken, accessToken: result.accessToken, accessTokenExpiresAt: result.expiresAt, grantedScopes: result.grantedScopes.length ? result.grantedScopes : stored.grantedScopes });
		await tokenStorage.markRefreshResult(c, scope, { onboardingMissionId, success: true });
		return { onboardingMissionId, outcome: 'refreshed' };
	}

	const classification = classifyRefreshFailure({ errorCode: result.errorCode, httpStatus: result.httpStatus || 0 });
	await tokenLifecycle.recordRepairAttempt(c, scope, { onboardingMissionId, classification: classification.classification, repairAction: classification.repairAction, attempt: 1 });
	if (classification.classification === 'REVOKED') {
		await tokenStorage.markRevoked(c, scope, { onboardingMissionId, reason: result.errorCode });
		return { onboardingMissionId, outcome: 'revoked', classification: classification.classification };
	}
	// Provider outage / throttling / unknown: preserve recoverable state (V19 -- never convert
	// a transient failure into a permanent one), just record the failed attempt.
	await tokenStorage.markRefreshResult(c, scope, { onboardingMissionId, success: false, health: classification.classification === 'PROVIDER_OUTAGE' || classification.classification === 'PROVIDER_THROTTLING' ? 'degraded' : 'unknown' });
	return { onboardingMissionId, outcome: 'failed', classification: classification.classification };
}

async function runScheduledRefresh({ env }, { limit = 10, fetchImpl } = {}) {
	const due = await dueForRefresh(env, { limit });
	const results = [];
	for (const row of due) {
		const scope = { tenantId: Number(row.tenant_id), workspaceId: Number(row.workspace_id) };
		const c = { env };
		results.push(await refreshOne(c, scope, { onboardingMissionId: row.onboarding_mission_id, provider: row.provider }, fetchImpl));
	}
	return { checked: due.length, refreshed: results.filter((r) => r.outcome === 'refreshed').length, revoked: results.filter((r) => r.outcome === 'revoked').length, failed: results.filter((r) => r.outcome === 'failed').length, results };
}

export { dueForRefresh, refreshOne };
export default { runScheduledRefresh };
