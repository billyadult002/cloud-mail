// Checkpoint 4 callback continuation authority. This module is deliberately
// D1-only: it records exact-once lineage and never touches provider APIs or
// credential material.
const uuid = () => crypto.randomUUID();
const same = (a, b) => Number(a) === Number(b);
const safeDigest = value => new TextEncoder().encode(String(value || '')).length ? String(value) : '';

function assertScope(row, scope) {
	if (!row || !same(row.tenant_id, scope.tenantId) || !same(row.workspace_id, scope.workspaceId)) throw new Error('nexora_callback_continuation_scope_denied');
}

function conflict(existing, expected, fields, error) {
	for (const field of fields) {
		const a = existing?.[field];
		const b = expected?.[field];
		if (typeof a === 'number' || typeof b === 'number') {
			if (!same(a, b)) throw new Error(error);
		} else if ((a || null) !== (b || null)) throw new Error(error);
	}
}

function abortOnZeroRows(c, table) {
	return c.env.db.prepare(`INSERT INTO ${table}(id) SELECT NULL WHERE changes()=0`);
}

async function hasColumn(db, table, column) {
	const info = await db.prepare(`PRAGMA table_info(${table})`).all();
	return (info.results || []).some((row) => row.name === column);
}

async function verifiedLineage(c, scope, args) {
	const verified = await c.env.db.prepare(`SELECT * FROM nexora_callback_verified_results WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND mission_id=?4 AND callback_correlation_id=?5 AND result_status='VERIFIED'`).bind(args.verifiedResultId, scope.tenantId, scope.workspaceId, args.missionId, args.callbackCorrelationId).first();
	assertScope(verified, scope);
	if (verified.provider !== args.provider || verified.verification_attempt_id !== args.verificationAttemptId || verified.verifier_authorization_id !== args.verifierAuthorizationId || verified.authority_tuple_digest !== args.authorityTupleDigest || verified.evidence_set_digest !== args.evidenceSetDigest || !same(verified.token_generation, args.expectedTokenGeneration) || verified.provider_connection_id !== args.expectedProviderConnectionId || !same(verified.provider_connection_generation, args.expectedProviderConnectionGeneration)) throw new Error('nexora_verified_callback_lineage_mismatch');
	const checkpoint = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_callback_checkpoints WHERE id=?1 AND correlation_id=?2 AND step='CALLBACK_OUTCOME_VERIFIED' AND status='VERIFIED'`).bind(verified.callback_outcome_verified_checkpoint_id, args.callbackCorrelationId).first();
	if (!checkpoint) throw new Error('nexora_callback_verified_checkpoint_missing');
	const finalization = await c.env.db.prepare(`SELECT * FROM nexora_callback_verified_outcome_finalizations WHERE id=?1 AND verified_outcome_reference=?2 AND callback_checkpoint_reference=?3 AND state='VERIFIED'`).bind(args.finalizationId, verified.id, checkpoint.id).first();
	if (!finalization || finalization.authority_tuple_digest !== args.authorityTupleDigest || finalization.evidence_set_digest !== args.evidenceSetDigest) throw new Error('nexora_callback_finalization_not_verified');
	const auth = await c.env.db.prepare(`SELECT * FROM nexora_callback_verifier_authorizations WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND mission_id=?4 AND callback_correlation_id=?5 AND consumed_at IS NOT NULL`).bind(args.verifierAuthorizationId, scope.tenantId, scope.workspaceId, args.missionId, args.callbackCorrelationId).first();
	if (!auth) throw new Error('nexora_callback_verifier_authorization_unconsumed');
	const attempt = await c.env.db.prepare(`SELECT * FROM nexora_callback_verification_attempts WHERE id=?1 AND verifier_authorization_id=?2 AND verification_policy_id=?3 AND verification_generation=?4 AND idempotency_key=?5 AND authority_tuple_digest=?6 AND evidence_set_digest=?7`).bind(args.verificationAttemptId, args.verifierAuthorizationId, args.expectedVerificationPolicyId, args.expectedVerificationGeneration, args.expectedVerificationIdempotencyKey, args.authorityTupleDigest, args.evidenceSetDigest).first();
	if (!attempt || !['PENDING', 'VERIFIED'].includes(attempt.status)) throw new Error('nexora_callback_verification_attempt_invalid');
	const blockedVerification = await c.env.db.prepare(`SELECT id FROM nexora_callback_verification_attempts WHERE tenant_id=?1 AND workspace_id=?2 AND mission_id=?3 AND callback_correlation_id=?4 AND status IN ('FAILED','BLOCKED') LIMIT 1`).bind(scope.tenantId, scope.workspaceId, args.missionId, args.callbackCorrelationId).first();
	if (blockedVerification) throw new Error('nexora_callback_verification_blocked');
	const evidence = await c.env.db.prepare(`SELECT id FROM nexora_onboarding_evidence_outbox WHERE commit_result_id=?1 AND onboarding_mission_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND status='DELIVERED'`).bind(verified.provider_outcome_result_id, args.missionId, scope.tenantId, scope.workspaceId).first();
	if (!evidence) throw new Error('nexora_callback_evidence_not_delivered');
	const hasOutcomeStatus = await hasColumn(c.env.db, 'nexora_provider_outcome_results', 'outcome_status');
	const outcomeStatusClause = hasOutcomeStatus ? `outcome_status='SUCCESS'` : `outcome_kind='SUCCESS'`;
	const outcome = await c.env.db.prepare(`SELECT * FROM nexora_provider_outcome_results WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND mission_id=?4 AND provider=?5 AND connection_id=?6 AND committed_token_generation=?7 AND committed_provider_connection_generation=?8 AND ${outcomeStatusClause}`).bind(verified.provider_outcome_result_id, scope.tenantId, scope.workspaceId, args.missionId, args.provider, args.expectedProviderConnectionId, args.expectedTokenGeneration, args.expectedProviderConnectionGeneration).first();
	if (!outcome) throw new Error('nexora_callback_provider_outcome_stale');
	const token = await c.env.db.prepare(`SELECT id FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND provider=?4 AND rotation_generation=?5 AND revoked_at IS NULL AND connection_health!='revoked'`).bind(args.missionId, scope.tenantId, scope.workspaceId, args.provider, args.expectedTokenGeneration).first();
	if (!token) throw new Error('nexora_callback_token_generation_stale');
	const connection = await c.env.db.prepare(`SELECT id FROM nexora_onboarding_provider_connections WHERE id=?1 AND onboarding_mission_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND provider=?5 AND generation=?6 AND connection_state='active'`).bind(args.expectedProviderConnectionId, args.missionId, scope.tenantId, scope.workspaceId, args.provider, args.expectedProviderConnectionGeneration).first();
	if (!connection) throw new Error('nexora_callback_connection_generation_stale');
	const binding = await c.env.db.prepare(`SELECT token_id FROM nexora_onboarding_token_connection_bindings WHERE token_id=?1 AND connection_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND provider=?5 AND token_generation=?6 AND connection_generation=?7`).bind(token.id, args.expectedProviderConnectionId, scope.tenantId, scope.workspaceId, args.provider, args.expectedTokenGeneration, args.expectedProviderConnectionGeneration).first();
	if (!binding) throw new Error('nexora_callback_token_connection_binding_missing');
	return { verified, checkpoint, finalization, auth, attempt, evidence, outcome, token };
}

async function completeReauthorization(c, scope, args) {
	const expected = {
		reauthorization_work_id: args.reauthorizationWorkId,
		idempotency_key: args.idempotencyKey,
		authority_tuple_digest: args.authorityTupleDigest,
		evidence_set_digest: args.evidenceSetDigest,
		verified_result_id: args.verifiedResultId,
		finalization_id: args.finalizationId,
		verifier_authorization_id: args.verifierAuthorizationId,
		verification_attempt_id: args.verificationAttemptId,
		tenant_id: scope.tenantId,
		workspace_id: scope.workspaceId,
		mission_id: args.missionId,
		provider: args.provider,
		authorization_session_id: args.authorizationSessionId,
		callback_correlation_id: args.callbackCorrelationId,
		replacement_authorization_session_id: args.replacementAuthorizationSessionId || null,
		replacement_correlation_id: args.replacementCorrelationId || null,
		token_generation: args.expectedTokenGeneration,
		provider_connection_id: args.expectedProviderConnectionId,
		provider_connection_generation: args.expectedProviderConnectionGeneration,
		lease_owner: args.owner,
		fencing_token: args.fencingToken,
	};
	const existing = await c.env.db.prepare(`SELECT * FROM nexora_reauthorization_completion_results WHERE idempotency_key=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(args.idempotencyKey, scope.tenantId, scope.workspaceId).first();
	if (existing) {
		conflict(existing, expected, Object.keys(expected), 'nexora_reauthorization_completion_conflict');
		return { id: existing.id, idempotent: true, status: existing.status };
	}
	await verifiedLineage(c, scope, args);
	const work = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_reauthorization_work WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND onboarding_mission_id=?4 AND provider=?5 AND original_authorization_session_id=?6 AND original_correlation_id=?7 AND status='AUTHORITY_RECEIVED' AND lease_owner=?8 AND fencing_token=?9 AND lease_expires_at>CURRENT_TIMESTAMP`).bind(args.reauthorizationWorkId, scope.tenantId, scope.workspaceId, args.missionId, args.provider, args.authorizationSessionId, args.callbackCorrelationId, args.owner, args.fencingToken).first();
	if (!work) throw new Error('nexora_reauthorization_completion_authority_invalid');
	if ((work.replacement_authorization_session_id || null) !== (args.replacementAuthorizationSessionId || null) || (work.replacement_correlation_id || null) !== (args.replacementCorrelationId || null) || !same(work.replacement_token_generation, args.expectedTokenGeneration)) throw new Error('nexora_reauthorization_replacement_lineage_invalid');
	const unresolved = await c.env.db.prepare(`SELECT id FROM nexora_onboarding_callback_claims WHERE correlation_id=?1 AND recovery_mode='RECONCILIATION' AND claim_status NOT IN ('COMPLETED','TERMINAL') LIMIT 1`).bind(args.callbackCorrelationId).first();
	if (unresolved) throw new Error('nexora_reconciliation_unresolved');
	const id = args.completionId || `reauth-completion:${args.reauthorizationWorkId}`;
	await c.env.db.batch([
		c.env.db.prepare(`INSERT INTO nexora_reauthorization_completion_results(id,reauthorization_work_id,idempotency_key,authority_tuple_digest,evidence_set_digest,verified_result_id,finalization_id,verifier_authorization_id,verification_attempt_id,tenant_id,workspace_id,mission_id,provider,authorization_session_id,callback_correlation_id,replacement_authorization_session_id,replacement_correlation_id,token_generation,provider_connection_id,provider_connection_generation,lease_owner,fencing_token,status) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,'COMPLETED')`).bind(id, args.reauthorizationWorkId, args.idempotencyKey, args.authorityTupleDigest, args.evidenceSetDigest, args.verifiedResultId, args.finalizationId, args.verifierAuthorizationId, args.verificationAttemptId, scope.tenantId, scope.workspaceId, args.missionId, args.provider, args.authorizationSessionId, args.callbackCorrelationId, args.replacementAuthorizationSessionId || null, args.replacementCorrelationId || null, args.expectedTokenGeneration, args.expectedProviderConnectionId, args.expectedProviderConnectionGeneration, args.owner, args.fencingToken),
		c.env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET status='COMPLETED',completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND status='AUTHORITY_RECEIVED' AND lease_owner=?4 AND fencing_token=?5 AND lease_expires_at>CURRENT_TIMESTAMP`).bind(args.reauthorizationWorkId, scope.tenantId, scope.workspaceId, args.owner, args.fencingToken),
		abortOnZeroRows(c, 'nexora_reauthorization_completion_results'),
	]);
	return { id, idempotent: false, status: 'COMPLETED' };
}

async function consumeCorrelation(c, scope, args) {
	const expected = {
		correlation_id: args.callbackCorrelationId,
		idempotency_key: args.idempotencyKey,
		mission_continuation_id: args.missionContinuationId,
		verified_result_id: args.verifiedResultId,
		finalization_id: args.finalizationId,
		verifier_authorization_id: args.verifierAuthorizationId,
		tenant_id: scope.tenantId,
		workspace_id: scope.workspaceId,
		mission_id: args.missionId,
		provider: args.provider,
		authorization_session_id: args.authorizationSessionId,
		replacement_authorization_session_id: args.replacementAuthorizationSessionId || null,
		replacement_correlation_id: args.replacementCorrelationId || null,
		token_generation: args.expectedTokenGeneration,
		provider_connection_id: args.expectedProviderConnectionId,
		provider_connection_generation: args.expectedProviderConnectionGeneration,
		lease_owner: args.owner,
		fencing_token: args.fencingToken,
	};
	const existing = await c.env.db.prepare(`SELECT * FROM nexora_callback_correlation_consumption_results WHERE idempotency_key=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(args.idempotencyKey, scope.tenantId, scope.workspaceId).first();
	if (existing) {
		conflict(existing, expected, Object.keys(expected), 'nexora_callback_correlation_consumption_conflict');
		return { id: existing.id, idempotent: true, status: existing.status };
	}
	await verifiedLineage(c, scope, args);
	const reauth = args.reauthorizationCompletionId ? await c.env.db.prepare(`SELECT * FROM nexora_reauthorization_completion_results WHERE id=?1 AND status='COMPLETED'`).bind(args.reauthorizationCompletionId).first() : null;
	if (args.reauthorizationCompletionId && !reauth) throw new Error('nexora_reauthorization_completion_incomplete');
	if (reauth) conflict(reauth, {
		verified_result_id: args.verifiedResultId,
		finalization_id: args.finalizationId,
		verifier_authorization_id: args.verifierAuthorizationId,
		verification_attempt_id: args.verificationAttemptId,
		tenant_id: scope.tenantId,
		workspace_id: scope.workspaceId,
		mission_id: args.missionId,
		provider: args.provider,
		authorization_session_id: args.authorizationSessionId,
		callback_correlation_id: args.callbackCorrelationId,
		replacement_authorization_session_id: args.replacementAuthorizationSessionId || null,
		replacement_correlation_id: args.replacementCorrelationId || null,
		token_generation: args.expectedTokenGeneration,
		provider_connection_id: args.expectedProviderConnectionId,
		provider_connection_generation: args.expectedProviderConnectionGeneration,
	}, ['verified_result_id', 'finalization_id', 'verifier_authorization_id', 'verification_attempt_id', 'tenant_id', 'workspace_id', 'mission_id', 'provider', 'authorization_session_id', 'callback_correlation_id', 'replacement_authorization_session_id', 'replacement_correlation_id', 'token_generation', 'provider_connection_id', 'provider_connection_generation'], 'nexora_reauthorization_completion_lineage_conflict');
	const correlation = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_callback_correlations WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND onboarding_mission_id=?4 AND provider=?5 AND authorization_session_id=?6 AND status=?7 AND consumed_at IS NULL AND claimed_by=?8 AND claim_generation=?9 AND claim_expires_at>CURRENT_TIMESTAMP`).bind(args.callbackCorrelationId, scope.tenantId, scope.workspaceId, args.missionId, args.provider, args.authorizationSessionId, args.expectedCorrelationState, args.owner, args.fencingToken).first();
	if (!correlation) throw new Error('nexora_callback_correlation_consumption_authority_invalid');
	const id = args.consumptionId || `correlation-consumption:${args.callbackCorrelationId}`;
	await c.env.db.batch([
		c.env.db.prepare(`INSERT INTO nexora_callback_correlation_consumption_results(id,correlation_id,idempotency_key,mission_continuation_id,reauthorization_completion_id,verified_result_id,finalization_id,verifier_authorization_id,tenant_id,workspace_id,mission_id,provider,authorization_session_id,replacement_authorization_session_id,replacement_correlation_id,token_generation,provider_connection_id,provider_connection_generation,lease_owner,fencing_token,status) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,'CONSUMED')`).bind(id, args.callbackCorrelationId, args.idempotencyKey, args.missionContinuationId, args.reauthorizationCompletionId || null, args.verifiedResultId, args.finalizationId, args.verifierAuthorizationId, scope.tenantId, scope.workspaceId, args.missionId, args.provider, args.authorizationSessionId, args.replacementAuthorizationSessionId || null, args.replacementCorrelationId || null, args.expectedTokenGeneration, args.expectedProviderConnectionId, args.expectedProviderConnectionGeneration, args.owner, args.fencingToken),
		c.env.db.prepare(`UPDATE nexora_onboarding_callback_correlations SET status='CONSUMED',consumed_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND status=?4 AND consumed_at IS NULL AND claimed_by=?5 AND claim_generation=?6 AND claim_expires_at>CURRENT_TIMESTAMP`).bind(args.callbackCorrelationId, scope.tenantId, scope.workspaceId, args.expectedCorrelationState, args.owner, args.fencingToken),
		abortOnZeroRows(c, 'nexora_callback_correlation_consumption_results'),
	]);
	return { id, idempotent: false, status: 'CONSUMED' };
}

async function continueMission(c, scope, args) {
	const expected = {
		idempotency_key: args.idempotencyKey,
		correlation_consumption_id: args.correlationConsumptionId,
		verified_result_id: args.verifiedResultId,
		mission_id: args.missionId,
		tenant_id: scope.tenantId,
		workspace_id: scope.workspaceId,
		provider: args.provider,
		resume_checkpoint: args.resumeCheckpoint,
		token_generation: args.expectedTokenGeneration,
		provider_connection_id: args.expectedProviderConnectionId,
		provider_connection_generation: args.expectedProviderConnectionGeneration,
		lease_owner: args.owner,
		fencing_token: args.fencingToken,
	};
	const existing = await c.env.db.prepare(`SELECT * FROM nexora_mission_continuation_results WHERE idempotency_key=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(args.idempotencyKey, scope.tenantId, scope.workspaceId).first();
	if (existing) {
		conflict(existing, expected, Object.keys(expected), 'nexora_mission_continuation_conflict');
		return { id: existing.id, idempotent: true, status: existing.status };
	}
	const consumption = await c.env.db.prepare(`SELECT * FROM nexora_callback_correlation_consumption_results WHERE id=?1 AND status='CONSUMED' AND mission_continuation_id=?2`).bind(args.correlationConsumptionId, args.continuationId).first();
	if (!consumption) throw new Error('nexora_callback_correlation_not_consumed');
	conflict(consumption, {
		verified_result_id: args.verifiedResultId,
		mission_id: args.missionId,
		tenant_id: scope.tenantId,
		workspace_id: scope.workspaceId,
		provider: args.provider,
		token_generation: args.expectedTokenGeneration,
		provider_connection_id: args.expectedProviderConnectionId,
		provider_connection_generation: args.expectedProviderConnectionGeneration,
		lease_owner: args.owner,
		fencing_token: args.fencingToken,
	}, ['verified_result_id', 'mission_id', 'tenant_id', 'workspace_id', 'provider', 'token_generation', 'provider_connection_id', 'provider_connection_generation', 'lease_owner', 'fencing_token'], 'nexora_callback_correlation_consumption_conflict');
	await verifiedLineage(c, scope, args);
	const mission = await c.env.db.prepare(`SELECT * FROM mission_runtime_missions WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND state=?4 AND checkpoint_id=?5`).bind(args.missionId, scope.tenantId, scope.workspaceId, args.expectedMissionState, args.resumeCheckpoint).first();
	if (!mission) throw new Error('nexora_mission_continuation_authority_invalid');
	const id = args.continuationId || `mission-continuation:${args.missionId}`;
	const syncIntentId = `sync-intent:${id}`;
	const syncDispatchId = `sync-dispatch:${id}`;
	const syncJobId = `sync-job:${id}`;
	const notificationId = `notification:${id}`;
	const existingEffect = await c.env.db.prepare(`SELECT 'intent' AS kind FROM nexora_initial_sync_intents WHERE id=?1 UNION ALL SELECT 'dispatch' AS kind FROM nexora_initial_sync_dispatches WHERE id=?2 UNION ALL SELECT 'job' AS kind FROM nexora_autonomy_jobs WHERE id=?3 UNION ALL SELECT 'notification' AS kind FROM nexora_onboarding_notifications WHERE id=?4 LIMIT 1`).bind(syncIntentId, syncDispatchId, syncJobId, notificationId).first();
	if (existingEffect) throw new Error('nexora_mission_continuation_child_effect_conflict');
	await c.env.db.batch([
		c.env.db.prepare(`INSERT INTO nexora_mission_continuation_results(id,idempotency_key,correlation_consumption_id,verified_result_id,mission_id,tenant_id,workspace_id,provider,resume_checkpoint,token_generation,provider_connection_id,provider_connection_generation,lease_owner,fencing_token,sync_intent_id,sync_dispatch_id,sync_job_id,notification_id,status) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,'CONTINUED')`).bind(id, args.idempotencyKey, args.correlationConsumptionId, args.verifiedResultId, args.missionId, scope.tenantId, scope.workspaceId, args.provider, args.resumeCheckpoint, args.expectedTokenGeneration, args.expectedProviderConnectionId, args.expectedProviderConnectionGeneration, args.owner, args.fencingToken, syncIntentId, syncDispatchId, syncJobId, notificationId),
		c.env.db.prepare(`UPDATE mission_runtime_missions SET state='runnable',continuation_idempotency_key=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?3 AND workspace_id=?4 AND state=?5 AND checkpoint_id=?6`).bind(args.missionId, args.idempotencyKey, scope.tenantId, scope.workspaceId, args.expectedMissionState, args.resumeCheckpoint),
		abortOnZeroRows(c, 'nexora_mission_continuation_results'),
		c.env.db.prepare(`INSERT OR IGNORE INTO nexora_initial_sync_intents(id,tenant_id,workspace_id,mission_id,callback_correlation_id,state) VALUES(?1,?2,?3,?4,?5,'READY')`).bind(syncIntentId, scope.tenantId, scope.workspaceId, args.missionId, consumption.correlation_id),
		c.env.db.prepare(`INSERT OR IGNORE INTO nexora_initial_sync_dispatches(id,tenant_id,workspace_id,mission_id,intent_id,state) VALUES(?1,?2,?3,?4,?5,'NOT_DISPATCHED')`).bind(syncDispatchId, scope.tenantId, scope.workspaceId, args.missionId, syncIntentId),
		c.env.db.prepare(`INSERT OR IGNORE INTO nexora_autonomy_jobs(id,user_id,job_type,idempotency_key,state,input_json) VALUES(?1,?2,'ZERO_TOUCH_INITIAL_SYNC',?1,'QUEUED',?3)`).bind(syncJobId, scope.tenantId, JSON.stringify({ tenant_id: scope.tenantId, workspace_id: scope.workspaceId, onboarding_mission_id: args.missionId, continuation_id: id, verified_result_id: args.verifiedResultId, correlation_consumption_id: args.correlationConsumptionId, provider: args.provider, token_generation: args.expectedTokenGeneration, provider_connection_generation: args.expectedProviderConnectionGeneration })),
		c.env.db.prepare(`INSERT OR IGNORE INTO nexora_onboarding_notifications(id,tenant_id,workspace_id,mission_id,state) VALUES(?1,?2,?3,?4,'NOT_SENT')`).bind(notificationId, scope.tenantId, scope.workspaceId, args.missionId),
	]);
	return { id, idempotent: false, status: 'CONTINUED', syncIntentId, syncDispatchId, syncJobId, notificationId };
}

async function checkpoint4Status(c, scope, { missionId }) {
	const rows = async sql => (await c.env.db.prepare(sql).bind(scope.tenantId, scope.workspaceId, missionId).all()).results || [];
	const reauth = await rows(`SELECT id,status,idempotency_key,lease_owner,fencing_token,completed_at FROM nexora_reauthorization_completion_results WHERE tenant_id=?1 AND workspace_id=?2 AND mission_id=?3 ORDER BY completed_at DESC LIMIT 5`);
	const consumption = await rows(`SELECT id,status,idempotency_key,lease_owner,fencing_token,consumed_at FROM nexora_callback_correlation_consumption_results WHERE tenant_id=?1 AND workspace_id=?2 AND mission_id=?3 ORDER BY consumed_at DESC LIMIT 5`);
	const continuation = await rows(`SELECT id,status,idempotency_key,resume_checkpoint,lease_owner,fencing_token,sync_intent_id,sync_dispatch_id,sync_job_id,notification_id,continued_at FROM nexora_mission_continuation_results WHERE tenant_id=?1 AND workspace_id=?2 AND mission_id=?3 ORDER BY continued_at DESC LIMIT 5`);
	return {
		reauthorization_completion: reauth.map(row => ({ ...row, idempotency_key_digest: safeDigest(row.idempotency_key).slice(0, 16), idempotency_key: undefined })),
		correlation_consumption: consumption.map(row => ({ ...row, idempotency_key_digest: safeDigest(row.idempotency_key).slice(0, 16), idempotency_key: undefined })),
		mission_continuation: continuation.map(row => ({ ...row, idempotency_key_digest: safeDigest(row.idempotency_key).slice(0, 16), idempotency_key: undefined })),
		retry_eligibility: reauth.length && consumption.length && continuation.length ? 'completed_idempotent_retry_only' : 'eligible_after_authority',
		blocked_reason: null,
		required_actor: 'checkpoint-4-worker',
		latest_redacted_evidence: null,
		restart_state: continuation.length ? 'continued' : consumption.length ? 'correlation_consumed' : reauth.length ? 'reauthorization_completed' : 'awaiting_completion',
		takeover_state: 'lease_and_fence_required',
	};
}

export { completeReauthorization, consumeCorrelation, continueMission, checkpoint4Status };
export default { completeReauthorization, consumeCorrelation, continueMission, checkpoint4Status };
