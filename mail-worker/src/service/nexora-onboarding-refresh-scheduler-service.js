// Durable, leased refresh work.  A scheduled event is only a trigger: D1 work rows own
// idempotency, lease recovery, and the token-generation fence used for the final commit.
import tokenStorage from './nexora-onboarding-token-storage-service.js';
import tokenLifecycle, { classifyTokenHealth, classifyRefreshFailure } from './nexora-onboarding-token-lifecycle-service.js';
import providerSession from './provider-session-service.js';
import connectionRuntime from './connection-runtime-service.js';

const uuid = () => crypto.randomUUID();
const REFRESH_TEST_HOOKS = Symbol.for('nexora.internal.connectionRefreshTestHooks');

async function dueForRefresh(env, { limit = 10, selection = null } = {}) {
	if (String(env.NEXORA_CONNECTION_RUNTIME_ENABLED || 'false').toLowerCase() === 'true') {
		if (!selection) throw new Error('connection_refresh_selection_required');
		if (![selection.tenant_id,selection.workspace_id,selection.account_id].every((value)=>Number.isSafeInteger(Number(value))&&Number(value)>0) || selection.provider!=='google') throw new Error('connection_refresh_selection_invalid');
	}
	const rows = selection
		? await env.db.prepare(`SELECT t.onboarding_mission_id,t.tenant_id,t.workspace_id,t.provider,t.access_token_expires_at,t.revoked_at,t.rotation_generation,c.id AS connection_id,c.account_id,c.connection_generation FROM nexora_onboarding_tokens t JOIN nexora_connections c ON c.credential_reference_id=t.id AND c.credential_generation=t.rotation_generation AND c.onboarding_mission_id=t.onboarding_mission_id AND c.tenant_id=t.tenant_id AND c.workspace_id=t.workspace_id AND c.provider=t.provider WHERE t.revoked_at IS NULL AND c.tenant_id=?1 AND c.workspace_id=?2 AND c.provider=?3 AND c.account_id=?4 AND c.state IN ('CONNECTED','HEALTHY','DEGRADED','RETRY_WAIT') ORDER BY t.access_token_expires_at LIMIT ?5`).bind(selection.tenant_id, selection.workspace_id, selection.provider, selection.account_id, limit).all()
		: await env.db.prepare(`SELECT onboarding_mission_id,tenant_id,workspace_id,provider,access_token_expires_at,revoked_at,rotation_generation FROM nexora_onboarding_tokens WHERE revoked_at IS NULL ORDER BY access_token_expires_at LIMIT ?1`).bind(limit).all();
	return (rows.results || []).filter((row) => ['expiring_soon', 'expired_refreshable'].includes(classifyTokenHealth({ expiresAt: row.access_token_expires_at, hasRefreshToken: true }).health));
}

async function enqueueAndClaim(env, row) {
	const idempotencyKey = `refresh:${row.onboarding_mission_id}:${row.rotation_generation}`;
	await env.db.prepare(`INSERT OR IGNORE INTO nexora_onboarding_refresh_work(id,idempotency_key,onboarding_mission_id,tenant_id,workspace_id,provider,expected_token_generation) VALUES(?1,?2,?3,?4,?5,?6,?7)`).bind(uuid(), idempotencyKey, row.onboarding_mission_id, row.tenant_id, row.workspace_id, row.provider, row.rotation_generation).run();
	const work = await env.db.prepare(`SELECT * FROM nexora_onboarding_refresh_work WHERE idempotency_key=?1`).bind(idempotencyKey).first();
	const leaseToken = uuid();
	const claim = await env.db.prepare(`UPDATE nexora_onboarding_refresh_work SET status='leased',lease_token=?2,lease_owner=?2,lease_acquired_at=CURRENT_TIMESTAMP,lease_expires_at=datetime('now','+5 minutes'),fence_generation=fence_generation+1,attempt_count=attempt_count+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND attempt_count<5 AND NOT EXISTS (SELECT 1 FROM nexora_connection_refresh_attempts a WHERE a.refresh_work_id=nexora_onboarding_refresh_work.id AND a.provider_request_started_at IS NOT NULL AND a.provider_response_observed_at IS NULL) AND (status='pending' OR (status='failed' AND next_retry_at IS NOT NULL AND next_retry_at<=CURRENT_TIMESTAMP) OR (status='leased' AND lease_expires_at < CURRENT_TIMESTAMP))`).bind(work.id, leaseToken).run();
	return claim.meta?.changes ? { ...work, lease_token: leaseToken, fence_generation: Number(work.fence_generation) + 1 } : null;
}

async function finishWork(env, work, status, errorClassification = null) {
	return env.db.prepare(`UPDATE nexora_onboarding_refresh_work SET status=?3,last_error_classification=?4,completed_at=CASE WHEN ?3 IN ('completed','revoked') OR ?4='REFRESH_OUTCOME_AMBIGUOUS_REAUTHORIZATION_REQUIRED' THEN CURRENT_TIMESTAMP ELSE completed_at END,next_retry_at=CASE WHEN ?3='failed' AND ?4!='REFRESH_OUTCOME_AMBIGUOUS_REAUTHORIZATION_REQUIRED' AND attempt_count<5 THEN datetime('now','+'||(MIN(900,(1 << MIN(attempt_count,9))*15)+(abs(random()) % 11))||' seconds') ELSE NULL END,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND status='leased' AND lease_token=?2`).bind(work.id, work.lease_token, status, errorClassification).run();
}

async function refreshOne(c, scope, work, fetchImpl) {
	const currentFence = await c.env.db
		.prepare(`SELECT t.id AS credential_reference_id,t.rotation_generation,t.revoked_at,pc.id AS provider_connection_id,pc.generation AS provider_connection_generation FROM nexora_onboarding_tokens t JOIN nexora_onboarding_token_connection_bindings b ON b.token_id=t.id AND b.tenant_id=t.tenant_id AND b.workspace_id=t.workspace_id AND b.provider=t.provider AND b.token_generation=t.rotation_generation JOIN nexora_onboarding_provider_connections pc ON pc.id=b.connection_id AND pc.tenant_id=b.tenant_id AND pc.workspace_id=b.workspace_id AND pc.provider=b.provider AND pc.generation=b.connection_generation AND pc.connection_state='active' WHERE t.onboarding_mission_id=?1 AND t.tenant_id=?2 AND t.workspace_id=?3 AND t.provider=?4`)
		.bind(work.onboarding_mission_id, scope.tenantId, scope.workspaceId, work.provider)
		.first();
	if (!currentFence || currentFence.revoked_at) {
		await finishWork(c.env, work, 'revoked', 'SKIPPED_REVOKED');
		return { onboardingMissionId: work.onboarding_mission_id, outcome: 'skipped_revoked' };
	}
	if (Number(currentFence.rotation_generation) !== Number(work.expected_token_generation)) {
		await finishWork(c.env, work, 'failed', 'FENCE_REJECTED_BEFORE_PROVIDER_CALL');
		return { onboardingMissionId: work.onboarding_mission_id, outcome: 'fenced' };
	}
	const attemptId=uuid();
	const attempt = await c.env.db.prepare(`INSERT OR IGNORE INTO nexora_connection_refresh_attempts(id,refresh_work_id,tenant_id,workspace_id,provider,expected_token_generation,fencing_token) SELECT ?1,?2,?3,?4,?5,?6,?7 WHERE EXISTS (SELECT 1 FROM nexora_onboarding_refresh_work WHERE id=?2 AND status='leased' AND lease_token=?8 AND fence_generation=?7 AND lease_expires_at>CURRENT_TIMESTAMP)`).bind(attemptId, work.id, scope.tenantId, scope.workspaceId, work.provider, work.expected_token_generation, work.fence_generation, work.lease_token).run();
	if (!attempt.meta?.changes) { await finishWork(c.env, work, 'failed', 'REFRESH_ATTEMPT_AUTHORITY_CONFLICT'); return { onboardingMissionId: work.onboarding_mission_id, outcome: 'fenced' }; }
	let session;
	let providerOutcome;
	let requestStarted=false;
	try {
		session = await providerSession.acquireRefreshSession(c, scope, { work, credentialReferenceId: currentFence.credential_reference_id, providerConnectionId: currentFence.provider_connection_id, providerConnectionGeneration: currentFence.provider_connection_generation, fetchImpl });
		const started=await c.env.db.prepare(`UPDATE nexora_connection_refresh_attempts SET provider_request_started_at=CURRENT_TIMESTAMP WHERE id=?1 AND refresh_work_id=?2 AND fencing_token=?3 AND provider_request_started_at IS NULL`).bind(attemptId,work.id,work.fence_generation).run();
		if(!started.meta?.changes) throw new Error('refresh_request_start_fence_rejected');
		requestStarted=true;
		if(c.env?.[REFRESH_TEST_HOOKS]?.throwAfterRequestStart) throw new Error('injected_refresh_crash_after_request_start');
		providerOutcome = await session.refreshAndCommit();
	} catch (error) {
		const classification=requestStarted?'REFRESH_OUTCOME_AMBIGUOUS_REAUTHORIZATION_REQUIRED':'PROVIDER_SESSION_ACQUISITION_FAILED';
		if(requestStarted) {
			const ambiguous=await c.env.db.prepare(`UPDATE nexora_connection_refresh_attempts SET terminal_classification='OUTCOME_AMBIGUOUS' WHERE id=?1 AND refresh_work_id=?2 AND fencing_token=?3 AND provider_request_started_at IS NOT NULL AND provider_response_observed_at IS NULL AND terminal_classification IS NULL`).bind(attemptId,work.id,work.fence_generation).run();
			if(!ambiguous.meta?.changes) throw new Error('refresh_ambiguity_ledger_commit_rejected');
		}
		const finished=await finishWork(c.env,work,'failed',classification);
		if(!finished.meta?.changes) throw new Error('refresh_ambiguity_work_commit_rejected');
		if(requestStarted&&String(c.env.NEXORA_CONNECTION_RUNTIME_ENABLED||'false').toLowerCase()==='true') {
			const connection=await c.env.db.prepare(`SELECT id,account_id,authority_generation,connection_generation FROM nexora_connections WHERE tenant_id=?1 AND workspace_id=?2 AND provider=?3 AND onboarding_mission_id=?4 AND credential_reference_id=?5`).bind(scope.tenantId,scope.workspaceId,work.provider,work.onboarding_mission_id,currentFence.credential_reference_id).first();
			if(connection) await connectionRuntime.requireReauthorization(c,{tenant_id:scope.tenantId,workspace_id:scope.workspaceId,actor_user_id:scope.tenantId,account_id:Number(connection.account_id),authority_generation:Number(connection.authority_generation),provider:work.provider,connection_id:connection.id,connection_generation:Number(connection.connection_generation)},{idempotencyKey:`refresh-ambiguous:${work.id}:${work.fence_generation}`});
		}
		return {onboardingMissionId:work.onboarding_mission_id,outcome:requestStarted?'reauthorization_required':'failed',classification};
	} finally { session?.close(); }
	const { result, committed } = providerOutcome;
	await c.env.db.prepare(`UPDATE nexora_connection_refresh_attempts SET provider_response_observed_at=CURRENT_TIMESTAMP,terminal_classification=?2 WHERE id=?1 AND refresh_work_id=?3 AND fencing_token=?4 AND provider_response_observed_at IS NULL`).bind(attemptId, result.ok ? 'SUCCESS_OBSERVED' : String(result.errorCode || 'PROVIDER_FAILURE_OBSERVED'),work.id,work.fence_generation).run();
	if (result.ok) {
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

async function runScheduledRefresh({ env }, { limit = 10, fetchImpl, selection = null } = {}) {
	const due = await dueForRefresh(env, { limit, selection });
	const results = [];
	for (const row of due) {
		const work = await enqueueAndClaim(env, row);
		if (!work) {
			const existing=await env.db.prepare(`SELECT attempt_count,status,next_retry_at FROM nexora_onboarding_refresh_work WHERE idempotency_key=?1`).bind(`refresh:${row.onboarding_mission_id}:${row.rotation_generation}`).first();
			results.push({ onboardingMissionId: row.onboarding_mission_id, outcome: Number(existing?.attempt_count)>=5 ? 'retry_exhausted' : existing?.status==='failed'&&existing?.next_retry_at ? 'retry_not_due' : 'leased_elsewhere' });
			continue;
		}
		results.push(await refreshOne({ env }, { tenantId: Number(row.tenant_id), workspaceId: Number(row.workspace_id) }, work, fetchImpl));
	}
	return { checked: due.length, refreshed: results.filter((r) => r.outcome === 'refreshed').length, revoked: results.filter((r) => r.outcome === 'revoked').length, failed: results.filter((r) => r.outcome === 'failed').length, results };
}

export { dueForRefresh, enqueueAndClaim, refreshOne };
export default { runScheduledRefresh, refreshOne };
