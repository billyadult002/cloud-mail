// Durable, leased refresh work.  A scheduled event is only a trigger: D1 work rows own
// idempotency, lease recovery, and the token-generation fence used for the final commit.
import tokenExchange from './nexora-onboarding-token-exchange-service.js';
import tokenStorage from './nexora-onboarding-token-storage-service.js';
import tokenLifecycle, { classifyTokenHealth, classifyRefreshFailure } from './nexora-onboarding-token-lifecycle-service.js';

const uuid = () => crypto.randomUUID();

async function dueForRefresh(env, { limit = 10 } = {}) {
	const rows = await env.db.prepare(`SELECT onboarding_mission_id,tenant_id,workspace_id,provider,access_token_expires_at,revoked_at,rotation_generation FROM nexora_onboarding_tokens WHERE revoked_at IS NULL ORDER BY access_token_expires_at LIMIT ?1`).bind(limit).all();
	return (rows.results || []).filter((row) => ['expiring_soon', 'expired_refreshable'].includes(classifyTokenHealth({ expiresAt: row.access_token_expires_at, hasRefreshToken: true }).health));
}

async function enqueueAndClaim(env, row) {
	const idempotencyKey = `refresh:${row.onboarding_mission_id}:${row.rotation_generation}`;
	await env.db.prepare(`INSERT OR IGNORE INTO nexora_onboarding_refresh_work(id,idempotency_key,onboarding_mission_id,tenant_id,workspace_id,provider,expected_token_generation) VALUES(?1,?2,?3,?4,?5,?6,?7)`).bind(uuid(), idempotencyKey, row.onboarding_mission_id, row.tenant_id, row.workspace_id, row.provider, row.rotation_generation).run();
	const work = await env.db.prepare(`SELECT * FROM nexora_onboarding_refresh_work WHERE idempotency_key=?1`).bind(idempotencyKey).first();
	const leaseToken = uuid();
	const claim = await env.db.prepare(`UPDATE nexora_onboarding_refresh_work SET status='leased',lease_token=?2,lease_owner=?2,lease_acquired_at=CURRENT_TIMESTAMP,lease_expires_at=datetime('now','+5 minutes'),fence_generation=fence_generation+1,attempt_count=attempt_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND (status IN ('pending','failed') OR (status='leased' AND lease_expires_at < CURRENT_TIMESTAMP))`).bind(work.id, leaseToken).run();
	return claim.meta?.changes ? { ...work, lease_token: leaseToken, fence_generation: Number(work.fence_generation) + 1 } : null;
}

async function finishWork(env, work, status, errorClassification = null) {
	await env.db.prepare(`UPDATE nexora_onboarding_refresh_work SET status=?3,last_error_classification=?4,completed_at=CASE WHEN ?3 IN ('completed','revoked') THEN CURRENT_TIMESTAMP ELSE completed_at END,lease_token=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND status='leased' AND lease_token=?2`).bind(work.id, work.lease_token, status, errorClassification).run();
}

async function refreshOne(c, scope, work, fetchImpl) {
	const currentFence = await c.env.db
		.prepare(`SELECT rotation_generation,revoked_at FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3`)
		.bind(work.onboarding_mission_id, scope.tenantId, scope.workspaceId)
		.first();
	if (!currentFence || currentFence.revoked_at) {
		await finishWork(c.env, work, 'revoked', 'SKIPPED_REVOKED');
		return { onboardingMissionId: work.onboarding_mission_id, outcome: 'skipped_revoked' };
	}
	if (Number(currentFence.rotation_generation) !== Number(work.expected_token_generation)) {
		await finishWork(c.env, work, 'failed', 'FENCE_REJECTED_BEFORE_PROVIDER_CALL');
		return { onboardingMissionId: work.onboarding_mission_id, outcome: 'fenced' };
	}
	const stored = await tokenStorage.retrieveForRuntimeUse(c, scope, { onboardingMissionId: work.onboarding_mission_id });
	if (!stored || stored.revoked) { await finishWork(c.env, work, 'revoked', 'SKIPPED_REVOKED'); return { onboardingMissionId: work.onboarding_mission_id, outcome: 'skipped_revoked' }; }
	const result = await tokenExchange.refreshAccessToken(c.env, { provider: work.provider, refreshToken: stored.refreshToken }, fetchImpl);
	if (result.ok) {
		const committed = await tokenStorage.commitRefreshWithFence(c, scope, { onboardingMissionId: work.onboarding_mission_id, expectedRotationGeneration: work.expected_token_generation, refreshWorkId: work.id, leaseToken: work.lease_token, fenceGeneration: work.fence_generation, refreshToken: result.refreshToken || stored.refreshToken, accessToken: result.accessToken, accessTokenExpiresAt: result.expiresAt, grantedScopes: result.grantedScopes.length ? result.grantedScopes : stored.grantedScopes });
		if (!committed.committed) { await finishWork(c.env, work, 'failed', 'FENCE_REJECTED'); return { onboardingMissionId: work.onboarding_mission_id, outcome: 'fenced' }; }
		await finishWork(c.env, work, 'completed');
		return { onboardingMissionId: work.onboarding_mission_id, outcome: 'refreshed' };
	}
	const classification = classifyRefreshFailure({ errorCode: result.errorCode, httpStatus: result.httpStatus || 0 });
	await tokenLifecycle.recordRepairAttempt(c, scope, { onboardingMissionId: work.onboarding_mission_id, classification: classification.classification, repairAction: classification.repairAction, attempt: work.attempt_count });
	if (classification.classification === 'REVOKED') {
		const revoked = await tokenStorage.commitRevocationWithFence(c, scope, { onboardingMissionId: work.onboarding_mission_id, expectedRotationGeneration: work.expected_token_generation, refreshWorkId: work.id, leaseToken: work.lease_token, fenceGeneration: work.fence_generation, revocationReason: result.errorCode, revocationObservationReference: `provider:${result.errorCode}` });
		await finishWork(c.env, work, revoked.committed ? 'revoked' : 'failed', revoked.committed ? classification.classification : 'FENCE_REJECTED');
		return { onboardingMissionId: work.onboarding_mission_id, outcome: revoked.committed ? 'revoked' : 'fenced', classification: classification.classification };
	}
	const health = classification.classification === 'PROVIDER_OUTAGE' || classification.classification === 'PROVIDER_THROTTLING' ? 'degraded' : 'unknown';
	const failed = await tokenStorage.commitRefreshFailureWithFence(c, scope, { onboardingMissionId: work.onboarding_mission_id, expectedRotationGeneration: work.expected_token_generation, refreshWorkId: work.id, leaseToken: work.lease_token, fenceGeneration: work.fence_generation, health: health === 'unknown' ? 'degraded' : health });
	if (!failed.committed) { await finishWork(c.env, work, 'failed', 'FENCE_REJECTED'); return { onboardingMissionId: work.onboarding_mission_id, outcome: 'fenced' }; }
	await finishWork(c.env, work, 'failed', classification.classification);
	return { onboardingMissionId: work.onboarding_mission_id, outcome: 'failed', classification: classification.classification };
}

async function runScheduledRefresh({ env }, { limit = 10, fetchImpl } = {}) {
	const due = await dueForRefresh(env, { limit });
	const results = [];
	for (const row of due) {
		const work = await enqueueAndClaim(env, row);
		if (!work) { results.push({ onboardingMissionId: row.onboarding_mission_id, outcome: 'leased_elsewhere' }); continue; }
		results.push(await refreshOne({ env }, { tenantId: Number(row.tenant_id), workspaceId: Number(row.workspace_id) }, work, fetchImpl));
	}
	return { checked: due.length, refreshed: results.filter((r) => r.outcome === 'refreshed').length, revoked: results.filter((r) => r.outcome === 'revoked').length, failed: results.filter((r) => r.outcome === 'failed').length, results };
}

export { dueForRefresh, enqueueAndClaim, refreshOne };
export default { runScheduledRefresh, refreshOne };
