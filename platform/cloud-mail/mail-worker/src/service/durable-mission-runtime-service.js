// Durable Mission P0 business state. nexora_autonomy_jobs remains the only transport.
// This module intentionally contains no credential access and no external send path.
import { decide as decideProviderAction } from './provider-capability-contract-service';
import enterpriseAuthorityService from './enterprise-authority-service';
const STATES = Object.freeze({
	// COMPENSATING/COMPENSATED close the gap identified in NEXORA_KERNEL_GAP_VERIFIED_AUDIT_REPORT.md.
	// 'running'/'verification_pending' may enter compensation for an already-dispatched action that
	// must be reversed; 'failed' may enter compensation only where policy permits (caller decides,
	// this table only says the transition is legal, not automatic). 'compensated' is terminal -- a
	// new Mission is required for further work, mirroring 'completed' and 'cancelled'.
	mission: { created: ['runnable', 'cancelled'], runnable: ['running', 'waiting_for_approval', 'blocked', 'cancelled'], running: ['verification_pending', 'retry_scheduled', 'failed', 'cancelled', 'compensating'], verification_pending: ['completed', 'blocked', 'failed', 'cancelled', 'compensating'], failed: ['compensating'], compensating: ['compensated', 'failed'], compensated: [] },
	step: { runnable: ['running', 'cancelled'], running: ['checkpointed', 'completed', 'failed', 'cancelled'], checkpointed: ['runnable', 'running', 'cancelled'] }
});
const uuid = () => crypto.randomUUID();
const same = (a, b) => Number(a) === Number(b);
const stable = value => Array.isArray(value) ? `[${value.map(stable).join(',')}]` : value && typeof value === 'object' ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}` : JSON.stringify(value);
const hash = async value => {
	const bytes = new TextEncoder().encode(typeof value === 'string' ? value : stable(value));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
};
const safeError = error => String(error?.message || error || 'runtime_error').replace(/(token|secret|password|authorization|credential)\S*/ig, '[redacted]').slice(0, 120);
const CALLBACK_FINALIZATION_TEST_HOOKS = Symbol.for('nexora.internal.callbackFinalizationTestHooks');
function getCallbackFinalizationTestHooks(c) {
	return c?.[CALLBACK_FINALIZATION_TEST_HOOKS] || c?.env?.[CALLBACK_FINALIZATION_TEST_HOOKS] || null;
}
function injectedFinalizationFailure(c, point) {
	return c.env.db.prepare(`INSERT INTO nexora_callback_finalization_injected_failure_${point}(id) VALUES('fail')`);
}
function maybeInjectFinalizationFailure(c, statements, point) {
	const hooks = getCallbackFinalizationTestHooks(c);
	if (hooks?.failAfter === point) statements.push(injectedFinalizationFailure(c, point));
}
function abortFinalizationOnZeroRows(c, point) {
	return c.env.db.prepare(`INSERT INTO nexora_callback_verified_outcome_finalizations(id,operation_id,idempotency_key,authority_tuple_digest,evidence_set_digest,verification_attempt_id,verifier_authorization_id,verified_outcome_reference,callback_checkpoint_reference,expected_token_generation,expected_provider_connection_generation,state,tenant_id,workspace_id,mission_id,callback_correlation_id) SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL WHERE changes()=0`);
}
function assertScope(row, scope) {
	if (!row || !same(row.tenant_id, scope.tenantId) || !same(row.workspace_id, scope.workspaceId)) throw new Error('mission_runtime_scope_denied');
}
async function resolveNexoraCallbackLineage(c, scope, { missionId, evidenceId, outboxId, commitResultId }) {
	const outbox = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_evidence_outbox WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND status='DELIVERED'`).bind(outboxId, scope.tenantId, scope.workspaceId).first();
	if (!outbox || (commitResultId && outbox.commit_result_id !== commitResultId) || outbox.onboarding_mission_id !== missionId) return { eligible: false, failures: ['evidence_outbox_lineage_invalid'] };
	const evidence = await c.env.db.prepare(`SELECT * FROM mission_runtime_evidence WHERE id=?1 AND mission_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND status='supported'`).bind(evidenceId, missionId, scope.tenantId, scope.workspaceId).first();
	if (!evidence) return { eligible: false, failures: ['canonical_evidence_missing'] };
	const outcome = await c.env.db.prepare(`SELECT * FROM nexora_provider_outcome_results WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND mission_id=?4`).bind(outbox.commit_result_id, scope.tenantId, scope.workspaceId, missionId).first();
	if (!outcome) return { eligible: false, failures: ['provider_outcome_missing'] };
	const authorityTuple = { tenantId: scope.tenantId, workspaceId: scope.workspaceId, missionId, provider: outcome.provider, connectionId: outcome.connection_id, tokenGeneration: outcome.committed_token_generation, providerConnectionGeneration: outcome.committed_provider_connection_generation, correlationId: outcome.correlation_id };
	const evidenceSet = [{ id: evidence.id, referenceHash: evidence.reference_hash }, { id: outbox.id, payload: outbox.payload_json }];
	return { eligible: true, authorityTuple, authorityTupleDigest: await hash(authorityTuple), evidenceSet, evidenceSetDigest: await hash(evidenceSet), failures: [] };
}
function allowed(entity, from, to) { return Boolean(STATES[entity]?.[from]?.includes(to)); }
function assertTransition(entity, from, to) { if (!allowed(entity, from, to)) throw new Error('mission_runtime_transition_rejected'); }
const verificationStates = new Set(['verified', 'not_verified', 'inconclusive', 'stale', 'conflicted']);
function evaluateEvidence({ policy, evidence = [], relations = [], now = Date.now() }) {
	const required = new Set(JSON.parse(policy.required_evidence_json || '[]'));
	const byId = new Map(evidence.map(row => [row.id, row]));
	const rejected = new Map(); const used = [];
	for (const row of evidence) {
		const reasons = [];
		if (!required.has(row.evidence_type)) reasons.push('evidence_class_not_required');
		if (row.status !== 'supported') reasons.push('evidence_not_supported');
		if (!row.integrity_hash || row.integrity_hash !== row.computed_integrity_hash) reasons.push('integrity_invalid');
		if (row.revoked_at || row.superseded_at) reasons.push('evidence_replaced_or_revoked');
		if (row.observed_at && now - Date.parse(row.observed_at) > Number(policy.freshness_seconds) * 1000) reasons.push('evidence_stale');
		rejected.set(row.id, reasons);
		if (!reasons.length) used.push(row);
	}
	let conflicted = false;
	for (const relation of relations) {
		if (!byId.has(relation.evidence_id) || !byId.has(relation.related_evidence_id)) continue;
		if (relation.relation_type === 'contradicts') conflicted = true;
		if (['supersedes', 'revokes'].includes(relation.relation_type)) rejected.get(relation.related_evidence_id)?.push('evidence_replaced_or_revoked');
		if (relation.relation_type === 'duplicates') rejected.get(relation.evidence_id)?.push('duplicate_evidence');
	}
	const accepted = used.filter(row => !rejected.get(row.id).length);
	const classes = new Set(accepted.map(row => row.evidence_type));
	const stale = [...rejected.values()].some(reasons => reasons.includes('evidence_stale'));
	const integrity = [...rejected.values()].some(reasons => reasons.includes('integrity_invalid'));
	const sufficient = required.size === classes.size && accepted.length >= Number(policy.minimum_distinct_evidence || 1);
	const state = conflicted ? 'conflicted' : stale ? 'stale' : integrity ? 'not_verified' : !sufficient ? 'inconclusive' : 'verified';
	return { state, accepted, rejected, sufficient, conflicted, stale, reasonCodes: [...new Set([...(conflicted ? ['evidence_conflict'] : []), ...(stale ? ['evidence_stale'] : []), ...(integrity ? ['integrity_invalid'] : []), ...(!sufficient ? ['evidence_insufficient'] : [])])] };
}
function evaluateVerifiedActionBoundary({ identityValid, authorityValid, capabilityValid, approvalRequired, approvalValid, executionPersisted, observationPersisted, requiredClaimsVerified, scopeConsistent, expectedVersionValid, fencingValid }) {
	if (!identityValid || !authorityValid || !capabilityValid) return { state: 'blocked', reason: 'authority_or_capability_missing' };
	if (approvalRequired && !approvalValid) return { state: 'waiting_for_approval', reason: 'exact_approval_missing', sendPermitted: false };
	if (!executionPersisted || !observationPersisted || !requiredClaimsVerified) return { state: 'verification_pending', reason: 'business_result_unverified', sendPermitted: false };
	if (!scopeConsistent || !expectedVersionValid || !fencingValid) return { state: 'blocked', reason: 'concurrency_or_scope_invalid', sendPermitted: false };
	return { state: 'verified', reason: 'verified_action_boundary_satisfied', sendPermitted: false };
}
async function audit(c, scope, event) {
	await c.env.db.prepare(`INSERT INTO mission_runtime_events(id,mission_id,run_id,step_id,action_id,tenant_id,workspace_id,event_type,from_state,to_state,expected_version,fencing_token,detail_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)`).bind(uuid(), event.missionId, event.runId || null, event.stepId || null, event.actionId || null, scope.tenantId, scope.workspaceId, event.type, event.from || null, event.to || null, event.expectedVersion ?? null, event.fencingToken ?? null, JSON.stringify(event.detail || {})).run();
}
async function getRun(c, scope, runId, fencingToken) {
	const run = await c.env.db.prepare(`SELECT * FROM mission_runtime_runs WHERE id=?1 AND state='running' AND lease_until>CURRENT_TIMESTAMP AND fencing_token=?2`).bind(runId, fencingToken).first();
	assertScope(run, scope); return run;
}
async function claimRun(c, scope, runId, leaseSeconds = 120) {
	const before = await c.env.db.prepare('SELECT * FROM mission_runtime_runs WHERE id=?1').bind(runId).first(); assertScope(before, scope);
	const result = await c.env.db.prepare(`UPDATE mission_runtime_runs SET state='running',fencing_token=fencing_token+1,lease_until=datetime('now','+' || ?2 || ' seconds'),version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?3 AND workspace_id=?4 AND (state IN ('runnable','retry_scheduled') OR (state='running' AND lease_until<CURRENT_TIMESTAMP))`).bind(runId, Math.max(15, Math.min(300, Number(leaseSeconds))), scope.tenantId, scope.workspaceId).run();
	if (!result.meta?.changes) throw new Error('mission_runtime_lease_conflict');
	const run = await c.env.db.prepare('SELECT * FROM mission_runtime_runs WHERE id=?1').bind(runId).first();
	await audit(c, scope, { missionId: run.mission_id, runId, type: 'RUN_LEASE_CLAIMED', from: before.state, to: run.state, expectedVersion: before.version, fencingToken: run.fencing_token });
	return run;
}
async function checkpoint(c, scope, { stepId, runId, fencingToken, expectedVersion, evidenceId = null }) {
	const run = await getRun(c, scope, runId, fencingToken);
	const step = await c.env.db.prepare('SELECT * FROM mission_runtime_steps WHERE id=?1 AND run_id=?2').bind(stepId, runId).first(); assertScope(step, scope);
	if (!same(step.version, expectedVersion) || !['running', 'checkpointed'].includes(step.state)) throw new Error('mission_runtime_checkpoint_conflict');
	const seq = Number(step.checkpoint_seq) + 1;
	const updated = await c.env.db.prepare(`UPDATE mission_runtime_steps SET state='checkpointed',checkpoint_seq=?2,version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND run_id=?3 AND tenant_id=?4 AND workspace_id=?5 AND version=?6 AND state IN ('running','checkpointed')`).bind(stepId, seq, runId, scope.tenantId, scope.workspaceId, expectedVersion).run();
	if (!updated.meta?.changes) throw new Error('mission_runtime_checkpoint_conflict');
	await c.env.db.prepare(`INSERT INTO mission_runtime_checkpoints(id,mission_id,run_id,step_id,tenant_id,workspace_id,seq,fencing_token,state,evidence_id) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,'checkpointed',?9)`).bind(uuid(), step.mission_id, runId, stepId, scope.tenantId, scope.workspaceId, seq, fencingToken, evidenceId).run();
	await audit(c, scope, { missionId: step.mission_id, runId, stepId, type: 'STEP_CHECKPOINTED', from: step.state, to: 'checkpointed', expectedVersion, fencingToken });
	return seq;
}
async function consumeApproval(c, scope, { approvalId, actionId, paramsHash, authorityGeneration, authorityContextHash, approverId }) {
	const result = await c.env.db.prepare(`UPDATE mission_runtime_approvals SET state='consumed',consumed_at=CURRENT_TIMESTAMP,approver_id=?2 WHERE id=?1 AND action_id=?3 AND params_hash=?4 AND authority_generation=?5 AND authority_context_hash=?6 AND tenant_id=?7 AND workspace_id=?8 AND state='approved' AND consumed_at IS NULL AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>CURRENT_TIMESTAMP)`).bind(approvalId, approverId, actionId, paramsHash, authorityGeneration, authorityContextHash, scope.tenantId, scope.workspaceId).run();
	if (!result.meta?.changes) throw new Error('mission_runtime_approval_invalid');
	return true;
}
async function integrityEnvelope(row) {
	return hash({ id: row.id, mission_id: row.mission_id, run_id: row.run_id, step_id: row.step_id, action_id: row.action_id || null, tenant_id: row.tenant_id, workspace_id: row.workspace_id, claim_key: row.claim_key, evidence_type: row.evidence_type, source_type: row.source_type, producer_type: row.producer_type, producer_id_hash: row.producer_id_hash, reference_hash: row.reference_hash, summary_json: row.summary_json, observed_at: row.observed_at, expires_at: row.expires_at || null });
}
async function verifyClaim(c, scope, { claimId, runId, actionId = null, verifier = 'deterministic_evidence_policy_v1' }) {
	const claim = await c.env.db.prepare(`SELECT c.*,p.required_evidence_json AS policy_required_evidence_json,p.freshness_seconds,p.minimum_distinct_evidence,p.conflict_mode,p.policy_hash FROM mission_runtime_claims c JOIN mission_runtime_verification_policies p ON p.id=c.policy_id AND p.version=c.policy_version WHERE c.id=?1`).bind(claimId).first();
	assertScope(claim, scope);
	let verifierAuthorizationId = null;
	let callbackCorrelationId = null;
	if (claim.claim_key === 'nexora_callback_outcome') {
		const callbackClaim = await c.env.db.prepare(`SELECT correlation_id FROM nexora_onboarding_callback_claims WHERE id=?1 AND onboarding_mission_id=?2 AND tenant_id=?3 AND workspace_id=?4`).bind(claimId, claim.mission_id, scope.tenantId, scope.workspaceId).first();
		callbackCorrelationId = callbackClaim?.correlation_id || null;
		if (!callbackCorrelationId) throw new Error('nexora_callback_claim_lineage_invalid');
	}
	const rows = await c.env.db.prepare(`SELECT * FROM mission_runtime_evidence WHERE mission_id=?1 AND claim_key=?2 AND tenant_id=?3 AND workspace_id=?4 ORDER BY created_at,id`).bind(claim.mission_id, claim.claim_key, scope.tenantId, scope.workspaceId).all();
	const evidence = [];
	for (const row of rows.results || []) evidence.push({ ...row, computed_integrity_hash: await integrityEnvelope(row) });
	// Callback outcomes have an additional durable boundary: Evidence is valid only
	// after its NEXORA outbox item is DELIVERED and its immutable provider result
	// still exists for the same mission and tenant/workspace.
	if (claim.claim_key === 'nexora_callback_outcome') {
		for (const row of evidence) {
			const commitResultId = String(row.id || '').startsWith('evidence:') ? String(row.id).slice('evidence:'.length) : null;
			const lineage = commitResultId ? await c.env.db.prepare(`SELECT o.id,r.id AS result_id FROM nexora_onboarding_evidence_outbox o JOIN nexora_provider_outcome_results r ON r.id=o.commit_result_id AND r.tenant_id=o.tenant_id AND r.workspace_id=o.workspace_id WHERE o.commit_result_id=?1 AND o.onboarding_mission_id=?2 AND o.tenant_id=?3 AND o.workspace_id=?4 AND o.status='DELIVERED'`).bind(commitResultId, claim.mission_id, scope.tenantId, scope.workspaceId).first() : null;
			if (!lineage) throw new Error('nexora_callback_evidence_lineage_unresolved');
		}
	}
	const ids = evidence.map(row => row.id);
	const relationRows = ids.length ? await c.env.db.prepare(`SELECT * FROM mission_runtime_evidence_relations WHERE tenant_id=?1 AND workspace_id=?2 AND (evidence_id IN (${ids.map(() => '?').join(',')}) OR related_evidence_id IN (${ids.map(() => '?').join(',')}))`).bind(scope.tenantId, scope.workspaceId, ...ids, ...ids).all() : { results: [] };
	const policy = { required_evidence_json: claim.policy_required_evidence_json, freshness_seconds: claim.freshness_seconds, minimum_distinct_evidence: claim.minimum_distinct_evidence, conflict_mode: claim.conflict_mode };
	const decision = evaluateEvidence({ policy, evidence, relations: relationRows.results || [] });
	if (!verificationStates.has(decision.state)) throw new Error('mission_runtime_verification_state_invalid');
	const setHash = await hash({ policy_id: claim.policy_id, policy_version: claim.policy_version, evidence: evidence.map(row => [row.id, row.integrity_hash]).sort() });
	const prior = await c.env.db.prepare(`SELECT * FROM mission_runtime_verifications WHERE claim_id=?1 AND run_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND COALESCE(action_id,'')=COALESCE(?5,'') ORDER BY created_at DESC LIMIT 1`).bind(claimId, runId, scope.tenantId, scope.workspaceId, actionId).first();
	if (prior) {
		if (prior.evidence_set_hash !== setHash && prior.state === 'verified') throw new Error('mission_runtime_verification_conflict');
		if (prior.evidence_set_hash === setHash && prior.state === 'verified') return { verificationId: prior.id, state: prior.state, accepted: [], rejected: new Map(), reasonCodes: JSON.parse(prior.reason_codes_json || '[]'), claim, idempotent: true };
	}
	if (claim.claim_key === 'nexora_callback_outcome') {
		const generation = Number(claim.version || 1);
		const authorityDigest = await hash({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, missionId: claim.mission_id, callbackClaimId: claimId, callbackCorrelationId, generation });
		const existingAuth = await c.env.db.prepare(`SELECT id FROM nexora_callback_verifier_authorizations WHERE tenant_id=?1 AND workspace_id=?2 AND mission_id=?3 AND callback_correlation_id=?4 AND verification_generation=?5 AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP`).bind(scope.tenantId, scope.workspaceId, claim.mission_id, callbackCorrelationId, generation).first();
		if (existingAuth) verifierAuthorizationId = existingAuth.id;
		else {
			verifierAuthorizationId = uuid();
			await c.env.db.prepare(`INSERT INTO nexora_callback_verifier_authorizations(id,verification_generation,verifier_identity,authority_digest,tenant_id,workspace_id,mission_id,callback_correlation_id,expires_at) VALUES(?1,?2,'canonical-mission-runtime-verifier',?3,?4,?5,?6,?7,datetime('now','+5 minutes'))`).bind(verifierAuthorizationId, generation, authorityDigest, scope.tenantId, scope.workspaceId, claim.mission_id, callbackCorrelationId).run();
		}
	}
	const verificationId = uuid();
	if (verifierAuthorizationId) {
		await c.env.db.prepare(`INSERT OR IGNORE INTO nexora_callback_verification_attempts(id,verification_policy_id,verification_generation,idempotency_key,evidence_set_digest,authority_tuple_digest,tenant_id,workspace_id,mission_id,callback_correlation_id,verifier_authorization_id,status,result_json,canonical_evidence_refs_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,'{}','[]')`).bind(verificationId, claim.policy_id, Number(claim.version || 1), `verify:${claimId}:${runId}:${actionId || ''}`, setHash, verifierAuthorizationId, scope.tenantId, scope.workspaceId, claim.mission_id, callbackCorrelationId, verifierAuthorizationId, decision.state === 'verified' ? 'VERIFIED' : decision.state === 'insufficient' ? 'FAILED' : 'PENDING').run();
	}
	await c.env.db.prepare(`INSERT INTO mission_runtime_verifications(id,mission_id,run_id,action_id,tenant_id,workspace_id,state,evidence_id,verifier,claim_id,policy_id,policy_version,evidence_set_hash,reason_codes_json,integrity_state) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)`).bind(verificationId, claim.mission_id, runId, actionId, scope.tenantId, scope.workspaceId, decision.state, decision.accepted[0]?.id || evidence[0]?.id || 'no_evidence', verifier, claimId, claim.policy_id, claim.policy_version, setHash, JSON.stringify(decision.reasonCodes), decision.reasonCodes.includes('integrity_invalid') ? 'invalid' : 'valid').run();
	for (const row of evidence) await c.env.db.prepare(`INSERT INTO mission_runtime_verification_evidence(verification_id,evidence_id,tenant_id,workspace_id,disposition,reason_code,evidence_integrity_hash) VALUES(?1,?2,?3,?4,?5,?6,?7)`).bind(verificationId, row.id, scope.tenantId, scope.workspaceId, decision.rejected.get(row.id).length ? 'rejected' : 'used', decision.rejected.get(row.id).join(',') || 'accepted', row.integrity_hash).run();
	await audit(c, scope, { missionId: claim.mission_id, runId, actionId, type: 'CLAIM_VERIFIED', detail: { claim_id: claimId, state: decision.state, policy: `${claim.policy_id}:${claim.policy_version}`, reason_codes: decision.reasonCodes } });
	return { verificationId, ...decision, claim };
}
async function finalizeVerifiedOutcome(c, scope, { missionId, runId, actionId, claimId, verificationId, expectedVersion, fencingToken, verifierAuthorizationId = null, expectedVerifierIdentity = 'canonical-mission-runtime-verifier' }) {
	const mission = await c.env.db.prepare('SELECT * FROM mission_runtime_missions WHERE id=?1').bind(missionId).first(); assertScope(mission, scope); await getRun(c, scope, runId, fencingToken);
	if (mission.state !== 'verification_pending' || !same(mission.version, expectedVersion)) throw new Error('mission_runtime_completion_conflict');
	const verification = await c.env.db.prepare(`SELECT v.*,c.policy_id AS claim_policy_id,c.policy_version AS claim_policy_version FROM mission_runtime_verifications v JOIN mission_runtime_claims c ON c.id=v.claim_id WHERE v.id=?1 AND v.claim_id=?2 AND v.mission_id=?3`).bind(verificationId, claimId, missionId).first(); assertScope(verification, scope);
	if (verification.state !== 'verified' || verification.integrity_state !== 'valid' || verification.policy_id !== verification.claim_policy_id || !same(verification.policy_version, verification.claim_policy_version)) throw new Error('mission_runtime_evidence_insufficient');
	const claimAuthority = await c.env.db.prepare(`SELECT claim_key FROM mission_runtime_claims WHERE id=?1 AND mission_id=?2 AND tenant_id=?3 AND workspace_id=?4`).bind(claimId, missionId, scope.tenantId, scope.workspaceId).first();
	if (claimAuthority?.claim_key === 'nexora_callback_outcome' && !verifierAuthorizationId) throw new Error('nexora_verifier_authorization_required');
	if (verifierAuthorizationId) {
		const attempt = await c.env.db.prepare(`SELECT * FROM nexora_callback_verification_attempts WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND mission_id=?4`).bind(verificationId, scope.tenantId, scope.workspaceId, missionId).first();
		if (!attempt || attempt.verifier_authorization_id !== verifierAuthorizationId || attempt.status !== 'VERIFIED' || attempt.verification_policy_id !== verification.policy_id || attempt.evidence_set_digest !== verification.evidence_set_hash) throw new Error('nexora_verifier_attempt_invalid');
		const authorization = await c.env.db.prepare(`SELECT * FROM nexora_callback_verifier_authorizations WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND mission_id=?4 AND verifier_identity=?5 AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP`).bind(verifierAuthorizationId, scope.tenantId, scope.workspaceId, missionId, expectedVerifierIdentity).first();
		if (!authorization) throw new Error('nexora_verifier_authorization_invalid');
	}
	const unverified = await c.env.db.prepare(`SELECT COUNT(*) AS count FROM mission_runtime_claims c WHERE c.mission_id=?1 AND c.tenant_id=?2 AND c.workspace_id=?3 AND NOT EXISTS (SELECT 1 FROM mission_runtime_verifications v WHERE v.claim_id=c.id AND v.state='verified' AND v.policy_id=c.policy_id AND v.policy_version=c.policy_version AND v.integrity_state='valid')`).bind(missionId, scope.tenantId, scope.workspaceId).first();
	if (Number(unverified?.count || 0)) throw new Error('mission_runtime_required_claims_unverified');
	const outcomeId = uuid(); await c.env.db.prepare(`INSERT INTO mission_runtime_outcomes(id,mission_id,tenant_id,workspace_id,state,verification_id,claim_key,action_id,policy_id,policy_version) VALUES(?1,?2,?3,?4,'verified',?5,?6,?7,?8,?9)`).bind(outcomeId, missionId, scope.tenantId, scope.workspaceId, verificationId, mission.claim_key, actionId, verification.policy_id, verification.policy_version).run();
	await complete(c, scope, { missionId, runId, outcomeId, expectedVersion, fencingToken }); return outcomeId;
}

// Callback-only finalization boundary. Unlike finalizeVerifiedOutcome(), this
// operation never calls complete() and therefore cannot advance Mission state.
async function finalizeNexoraCallbackVerifiedOutcome(c, scope, { finalizationId, idempotencyKey, authorizationId, verificationAttemptId, missionId, callbackCorrelationId, callbackClaimId, providerOutcomeResultId, expectedProviderConnectionId, expectedAuthorityTupleDigest, expectedEvidenceSetDigest, expectedTokenGeneration, expectedProviderConnectionGeneration, expectedVerifierIdentity = 'canonical-mission-runtime-verifier', expectedVerificationPolicyId = 'policy-1', expectedVerificationGeneration = 1, expectedVerificationIdempotencyKey = 'verify-1' }) {
	const existing = await c.env.db.prepare(`SELECT * FROM nexora_callback_verified_outcome_finalizations WHERE idempotency_key=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(idempotencyKey, scope.tenantId, scope.workspaceId).first();
	if (existing) {
		if (existing.authority_tuple_digest !== expectedAuthorityTupleDigest || existing.evidence_set_digest !== expectedEvidenceSetDigest || existing.verification_attempt_id !== verificationAttemptId || existing.verifier_authorization_id !== authorizationId || existing.mission_id !== missionId || existing.callback_correlation_id !== callbackCorrelationId || Number(existing.expected_token_generation) !== Number(expectedTokenGeneration) || Number(existing.expected_provider_connection_generation) !== Number(expectedProviderConnectionGeneration)) throw new Error('nexora_callback_finalization_conflict');
		const existingResult = existing.verified_outcome_reference ? await c.env.db.prepare(`SELECT provider_outcome_result_id,provider_connection_id FROM nexora_callback_verified_results WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(existing.verified_outcome_reference, scope.tenantId, scope.workspaceId).first() : null;
		if (existingResult && (existingResult.provider_outcome_result_id !== providerOutcomeResultId || existingResult.provider_connection_id !== expectedProviderConnectionId)) throw new Error('nexora_callback_finalization_conflict');
		if (existing.state === 'VERIFIED') return { id: existing.id, idempotent: true, state: existing.state, checkpointReference: existing.callback_checkpoint_reference, outcomeReference: existing.verified_outcome_reference };
	}
	const auth = await c.env.db.prepare(`SELECT * FROM nexora_callback_verifier_authorizations WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND mission_id=?4 AND callback_correlation_id=?5 AND verifier_identity=?6 AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP`).bind(authorizationId, scope.tenantId, scope.workspaceId, missionId, callbackCorrelationId, expectedVerifierIdentity).first();
	if (!auth) throw new Error('nexora_verifier_authorization_invalid');
	if (expectedTokenGeneration == null) throw new Error('nexora_token_generation_required');
	if (!expectedProviderConnectionId || expectedProviderConnectionGeneration == null) throw new Error('nexora_provider_connection_authority_required');
	const attempt = await c.env.db.prepare(`SELECT * FROM nexora_callback_verification_attempts WHERE id=?1 AND verifier_authorization_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND mission_id=?5 AND callback_correlation_id=?6 AND evidence_set_digest=?7 AND authority_tuple_digest=?8 AND verification_policy_id=?9 AND verification_generation=?10 AND idempotency_key=?11`).bind(verificationAttemptId, authorizationId, scope.tenantId, scope.workspaceId, missionId, callbackCorrelationId, expectedEvidenceSetDigest, expectedAuthorityTupleDigest, expectedVerificationPolicyId, expectedVerificationGeneration, expectedVerificationIdempotencyKey).first();
	if (!attempt || !['PENDING','VERIFIED'].includes(attempt.status)) throw new Error('nexora_callback_verification_attempt_invalid');
	const atomicCallback = await c.env.db.prepare(`SELECT commit_result_id FROM nexora_onboarding_evidence_outbox WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND status='DELIVERED' ORDER BY delivered_at DESC LIMIT 1`).bind(missionId, scope.tenantId, scope.workspaceId).first();
	if (!atomicCallback?.commit_result_id) throw new Error('nexora_atomic_callback_result_missing');
	if (atomicCallback.commit_result_id !== providerOutcomeResultId) throw new Error('nexora_atomic_callback_result_mismatch');
	const canonicalEvidence = await c.env.db.prepare(`SELECT id FROM mission_runtime_evidence WHERE mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND claim_key='nexora_callback_outcome' AND status='supported' ORDER BY created_at DESC LIMIT 1`).bind(missionId, scope.tenantId, scope.workspaceId).first();
	if (!canonicalEvidence) throw new Error('nexora_callback_canonical_evidence_missing');
	const correlation = await c.env.db.prepare(`SELECT id,status FROM nexora_onboarding_callback_correlations WHERE id=?1 AND onboarding_mission_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND consumed_at IS NULL`).bind(callbackCorrelationId, missionId, scope.tenantId, scope.workspaceId).first();
	if (!correlation || !['claimed','VERIFIED_PENDING_CONSUMPTION'].includes(correlation.status)) throw new Error('nexora_callback_correlation_lineage_invalid');
	const callbackMissionClaim = await c.env.db.prepare(`SELECT id FROM mission_runtime_claims WHERE id=?1 AND mission_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND claim_key='nexora_callback_outcome'`).bind(callbackClaimId, missionId, scope.tenantId, scope.workspaceId).first();
	const callbackClaim = await c.env.db.prepare(`SELECT id FROM nexora_onboarding_callback_claims WHERE id=?1 AND correlation_id=?2 AND onboarding_mission_id=?3 AND tenant_id=?4 AND workspace_id=?5`).bind(callbackClaimId, callbackCorrelationId, missionId, scope.tenantId, scope.workspaceId).first();
	if (!callbackMissionClaim || !callbackClaim) throw new Error('nexora_callback_claim_lineage_invalid');
	const conflictingCheckpoint = await c.env.db.prepare(`SELECT id FROM nexora_onboarding_callback_checkpoints WHERE correlation_id=?1 AND step='CALLBACK_OUTCOME_VERIFIED' AND status!='VERIFIED' LIMIT 1`).bind(callbackCorrelationId).first();
	if (conflictingCheckpoint) throw new Error('nexora_callback_checkpoint_lineage_invalid');
	const reauthorizationConflict = await c.env.db.prepare(`SELECT id FROM nexora_onboarding_reauthorization_work WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND (original_correlation_id=?4 OR replacement_correlation_id=?4) AND status NOT IN ('PENDING','WAITING_FOR_USER','AUTHORITY_RECEIVED') LIMIT 1`).bind(missionId, scope.tenantId, scope.workspaceId, callbackCorrelationId).first();
	if (reauthorizationConflict) throw new Error('nexora_reauthorization_lineage_ineligible');
	const providerOutcome = await c.env.db.prepare(`SELECT provider,connection_id,committed_token_generation,committed_provider_connection_generation FROM nexora_provider_outcome_results WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND mission_id=?4`).bind(providerOutcomeResultId, scope.tenantId, scope.workspaceId, missionId).first();
	if (!providerOutcome || Number(providerOutcome.committed_token_generation) !== Number(expectedTokenGeneration) || Number(providerOutcome.committed_provider_connection_generation) !== Number(expectedProviderConnectionGeneration)) throw new Error('nexora_generation_authority_mismatch');
	if (providerOutcome.connection_id !== expectedProviderConnectionId) throw new Error('nexora_provider_connection_authority_mismatch');
	const tokenAuthority = await c.env.db.prepare(`SELECT id,tenant_id,workspace_id,provider,rotation_generation,connection_health,revoked_at FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND provider=?4 AND rotation_generation=?5 AND revoked_at IS NULL AND connection_health!='revoked'`).bind(missionId, scope.tenantId, scope.workspaceId, providerOutcome.provider, expectedTokenGeneration).first();
	if (!tokenAuthority) throw new Error('nexora_token_authority_mismatch');
	const connection = await c.env.db.prepare(`SELECT id,tenant_id,workspace_id,provider,generation,connection_state FROM nexora_onboarding_provider_connections WHERE id=?1 AND onboarding_mission_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND generation=?5 AND connection_state='active'`).bind(expectedProviderConnectionId, missionId, scope.tenantId, scope.workspaceId, expectedProviderConnectionGeneration).first();
	if (!connection || connection.provider !== providerOutcome.provider) throw new Error('nexora_provider_connection_authority_mismatch');
	const binding = await c.env.db.prepare(`SELECT token_id,connection_id,token_generation,connection_generation FROM nexora_onboarding_token_connection_bindings WHERE connection_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND provider=?4`).bind(expectedProviderConnectionId, scope.tenantId, scope.workspaceId, providerOutcome.provider).first();
	if (!binding || binding.connection_id !== expectedProviderConnectionId || binding.token_id !== tokenAuthority.id || Number(binding.token_generation) !== Number(expectedTokenGeneration) || Number(binding.connection_generation) !== Number(expectedProviderConnectionGeneration)) throw new Error('nexora_token_connection_binding_mismatch');
	const hooks = getCallbackFinalizationTestHooks(c);
	if (typeof hooks?.beforeFinalizationBatch === 'function') await hooks.beforeFinalizationBatch({ scope, request: { finalizationId, idempotencyKey, authorizationId, verificationAttemptId, missionId, callbackCorrelationId, callbackClaimId, providerOutcomeResultId, expectedProviderConnectionId, expectedAuthorityTupleDigest, expectedEvidenceSetDigest, expectedTokenGeneration, expectedProviderConnectionGeneration, expectedVerifierIdentity }, resolved: { attempt, atomicCallback, providerOutcome, tokenAuthority, connection, binding } });
	const checkpointId = `nexora-callback-verified:${finalizationId}`;
	const verifiedResultId = `nexora-callback-result:${finalizationId}`;
	const statements = [];
	maybeInjectFinalizationFailure(c, statements, 'finalization_state_acquisition');
	maybeInjectFinalizationFailure(c, statements, 'atomic_result_revalidation');
	maybeInjectFinalizationFailure(c, statements, 'provider_outcome_revalidation');
	maybeInjectFinalizationFailure(c, statements, 'token_authority_revalidation');
	maybeInjectFinalizationFailure(c, statements, 'provider_connection_revalidation');
	maybeInjectFinalizationFailure(c, statements, 'token_connection_binding_revalidation');
	statements.push(c.env.db.prepare(`INSERT INTO nexora_callback_verified_results(id,finalization_operation_id,finalization_idempotency_key,verification_attempt_id,verifier_authorization_id,verification_policy_id,verification_generation,tenant_id,workspace_id,mission_id,provider,callback_correlation_id,authority_tuple_digest,evidence_set_digest,atomic_callback_result_id,provider_outcome_result_id,token_generation,provider_connection_id,provider_connection_generation,callback_outcome_verified_checkpoint_id,result_status) SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,p.provider,?11,?12,?13,?14,?15,?16,?17,?18,?19,'VERIFIED' FROM nexora_provider_outcome_results p WHERE p.id=?15 AND p.tenant_id=?8 AND p.workspace_id=?9 AND p.mission_id=?10 AND p.connection_id=?17 AND p.committed_token_generation=?16 AND p.committed_provider_connection_generation=?18 AND EXISTS (SELECT 1 FROM nexora_onboarding_tokens t WHERE t.onboarding_mission_id=?10 AND t.tenant_id=?8 AND t.workspace_id=?9 AND t.provider=p.provider AND t.rotation_generation=?16 AND t.revoked_at IS NULL AND t.connection_health!='revoked') AND EXISTS (SELECT 1 FROM nexora_onboarding_provider_connections c WHERE c.id=?17 AND c.onboarding_mission_id=?10 AND c.tenant_id=?8 AND c.workspace_id=?9 AND c.provider=p.provider AND c.generation=?18 AND c.connection_state='active') AND EXISTS (SELECT 1 FROM nexora_onboarding_token_connection_bindings b JOIN nexora_onboarding_tokens t ON t.id=b.token_id AND t.onboarding_mission_id=?10 AND t.tenant_id=?8 AND t.workspace_id=?9 AND t.provider=p.provider AND t.rotation_generation=?16 AND t.revoked_at IS NULL AND t.connection_health!='revoked' WHERE b.connection_id=?17 AND b.tenant_id=?8 AND b.workspace_id=?9 AND b.provider=p.provider AND b.token_generation=?16 AND b.connection_generation=?18)`).bind(verifiedResultId, finalizationId, idempotencyKey, verificationAttemptId, authorizationId, attempt.verification_policy_id, attempt.verification_generation, scope.tenantId, scope.workspaceId, missionId, callbackCorrelationId, expectedAuthorityTupleDigest, expectedEvidenceSetDigest, atomicCallback.commit_result_id, providerOutcomeResultId, expectedTokenGeneration, expectedProviderConnectionId, expectedProviderConnectionGeneration, checkpointId));
	statements.push(abortFinalizationOnZeroRows(c, 'verified_result'));
	maybeInjectFinalizationFailure(c, statements, 'verified_result_insertion');
	statements.push(c.env.db.prepare(`INSERT INTO nexora_onboarding_callback_checkpoints(id,correlation_id,claim_id,fencing_token,step,status,attempt) SELECT NULL,NULL,NULL,0,'CALLBACK_OUTCOME_VERIFIED','VERIFIED',0 WHERE changes()=0`));
	statements.push(c.env.db.prepare(`INSERT INTO nexora_onboarding_callback_checkpoints(id,correlation_id,claim_id,fencing_token,step,status,attempt,persisted_at,completed_at) VALUES(?1,?2,?3,0,'CALLBACK_OUTCOME_VERIFIED','VERIFIED',1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)`).bind(checkpointId, callbackCorrelationId, callbackClaimId));
	maybeInjectFinalizationFailure(c, statements, 'callback_outcome_verified_insertion');
	maybeInjectFinalizationFailure(c, statements, 'verified_result_checkpoint_binding');
	statements.push(c.env.db.prepare(`INSERT INTO nexora_callback_verified_outcome_finalizations(id,operation_id,idempotency_key,authority_tuple_digest,evidence_set_digest,verification_attempt_id,verifier_authorization_id,verified_outcome_reference,callback_checkpoint_reference,expected_token_generation,expected_provider_connection_generation,state,tenant_id,workspace_id,mission_id,callback_correlation_id) VALUES(?1,?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'VERIFIED',?11,?12,?13,?14)`).bind(finalizationId, idempotencyKey, expectedAuthorityTupleDigest, expectedEvidenceSetDigest, verificationAttemptId, authorizationId, verifiedResultId, checkpointId, expectedTokenGeneration, expectedProviderConnectionGeneration, scope.tenantId, scope.workspaceId, missionId, callbackCorrelationId));
	maybeInjectFinalizationFailure(c, statements, 'finalization_verified_result_binding');
	statements.push(c.env.db.prepare(`INSERT INTO nexora_onboarding_callback_checkpoints(id,correlation_id,claim_id,fencing_token,step,status,attempt) SELECT NULL,NULL,NULL,0,'CALLBACK_OUTCOME_VERIFIED','VERIFIED',0 WHERE changes()=0`));
	maybeInjectFinalizationFailure(c, statements, 'finalization_checkpoint_binding');
	statements.push(c.env.db.prepare(`UPDATE nexora_callback_verifier_authorizations SET consumed_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND verifier_identity=?4 AND consumed_at IS NULL AND expires_at>CURRENT_TIMESTAMP`).bind(authorizationId, scope.tenantId, scope.workspaceId, expectedVerifierIdentity));
	statements.push(abortFinalizationOnZeroRows(c, 'verifier_authorization'));
	maybeInjectFinalizationFailure(c, statements, 'verifier_authorization_consumption');
	statements.push(c.env.db.prepare(`INSERT INTO nexora_onboarding_callback_checkpoints(id,correlation_id,claim_id,fencing_token,step,status,attempt) SELECT NULL,NULL,NULL,0,'CALLBACK_OUTCOME_VERIFIED','VERIFIED',0 WHERE changes()=0`));
	maybeInjectFinalizationFailure(c, statements, 'finalization_verified_transition');
	maybeInjectFinalizationFailure(c, statements, 'final_pre_commit_boundary');
	await c.env.db.batch(statements);
	return { id: finalizationId, idempotent: false, state: 'VERIFIED', checkpointReference: checkpointId, outcomeReference: verifiedResultId };
}
async function complete(c, scope, { missionId, runId, outcomeId, expectedVersion, fencingToken }) {
	const mission = await c.env.db.prepare('SELECT * FROM mission_runtime_missions WHERE id=?1').bind(missionId).first(); assertScope(mission, scope);
	if (mission.state !== 'verification_pending' || !same(mission.version, expectedVersion)) throw new Error('mission_runtime_completion_conflict');
	await getRun(c, scope, runId, fencingToken);
	const outcome = await c.env.db.prepare(`SELECT o.*,v.state AS verification_state,e.status AS evidence_status,e.expires_at AS evidence_expires_at,e.claim_key AS evidence_claim_key FROM mission_runtime_outcomes o JOIN mission_runtime_verifications v ON v.id=o.verification_id LEFT JOIN mission_runtime_evidence e ON e.id=v.evidence_id WHERE o.id=?1 AND o.mission_id=?2`).bind(outcomeId, missionId).first();
	assertScope(outcome, scope);
	if (outcome.state !== 'verified' || outcome.verification_state !== 'verified' || outcome.evidence_status !== 'supported' || outcome.evidence_claim_key !== mission.claim_key || (outcome.evidence_expires_at && Number.isFinite(Date.parse(outcome.evidence_expires_at)) && Date.parse(outcome.evidence_expires_at) <= Date.now())) throw new Error('mission_runtime_evidence_insufficient');
	const result = await c.env.db.prepare(`UPDATE mission_runtime_missions SET state='completed',version=version+1,completed_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND state='verification_pending' AND version=?4`).bind(missionId, scope.tenantId, scope.workspaceId, expectedVersion).run();
	if (!result.meta?.changes) throw new Error('mission_runtime_completion_conflict');
	await audit(c, scope, { missionId, runId, type: 'MISSION_COMPLETED', from: mission.state, to: 'completed', expectedVersion, fencingToken, detail: { outcome_id: outcomeId } });
	return true;
}
// Compensation: reverses the business effect of an already-dispatched, evidence-verified
// action. It never edits or deletes the original action's evidence (append-only, enforced by
// the mission_runtime_evidence_no_update/no_delete triggers) -- it records a new, independent
// compensation record and drives the mission through compensating -> compensated|failed using
// the same fencing/optimistic-concurrency discipline as every other transition in this module.
async function beginCompensation(c, scope, { missionId, runId, fencingToken, expectedVersion, originalActionId, reason, authorizationReference, capability, providerTargetHash }) {
	const mission = await c.env.db.prepare('SELECT * FROM mission_runtime_missions WHERE id=?1').bind(missionId).first(); assertScope(mission, scope);
	assertTransition('mission', mission.state, 'compensating');
	if (!same(mission.version, expectedVersion)) throw new Error('mission_runtime_compensation_conflict');
	await getRun(c, scope, runId, fencingToken);
	const result = await c.env.db.prepare(`UPDATE mission_runtime_missions SET state='compensating',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND state=?4 AND version=?5`).bind(missionId, scope.tenantId, scope.workspaceId, mission.state, expectedVersion).run();
	if (!result.meta?.changes) throw new Error('mission_runtime_compensation_conflict');
	const compensationId = uuid();
	const attemptRow = await c.env.db.prepare(`SELECT COALESCE(MAX(attempt),0) AS attempt FROM mission_runtime_compensations WHERE mission_id=?1 AND original_action_id=?2`).bind(missionId, originalActionId).first();
	const attempt = Number(attemptRow?.attempt || 0) + 1;
	await c.env.db.prepare(`INSERT INTO mission_runtime_compensations(id,mission_id,run_id,original_action_id,tenant_id,workspace_id,reason,authorization_reference,capability,provider_target_hash,attempt,state) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'pending')`).bind(compensationId, missionId, runId, originalActionId, scope.tenantId, scope.workspaceId, reason, authorizationReference, capability, providerTargetHash, attempt).run();
	await audit(c, scope, { missionId, runId, type: 'COMPENSATION_STARTED', from: mission.state, to: 'compensating', expectedVersion, fencingToken, detail: { compensation_id: compensationId, original_action_id: originalActionId, reason, attempt } });
	return compensationId;
}
async function dispatchCompensation(c, scope, { compensationId, compensationActionId }) {
	const compensation = await c.env.db.prepare('SELECT * FROM mission_runtime_compensations WHERE id=?1').bind(compensationId).first(); assertScope(compensation, scope);
	if (compensation.state !== 'pending') throw new Error('mission_runtime_compensation_state_invalid');
	const result = await c.env.db.prepare(`UPDATE mission_runtime_compensations SET state='dispatched',compensation_action_id=?2 WHERE id=?1 AND tenant_id=?3 AND workspace_id=?4 AND state='pending'`).bind(compensationId, compensationActionId, scope.tenantId, scope.workspaceId).run();
	if (!result.meta?.changes) throw new Error('mission_runtime_compensation_state_invalid');
	return true;
}
async function observeCompensation(c, scope, { compensationId, observedResult }) {
	const compensation = await c.env.db.prepare('SELECT * FROM mission_runtime_compensations WHERE id=?1').bind(compensationId).first(); assertScope(compensation, scope);
	if (compensation.state !== 'dispatched') throw new Error('mission_runtime_compensation_state_invalid');
	const result = await c.env.db.prepare(`UPDATE mission_runtime_compensations SET state='observed',observed_result=?2 WHERE id=?1 AND tenant_id=?3 AND workspace_id=?4 AND state='dispatched'`).bind(compensationId, JSON.stringify(observedResult ?? null), scope.tenantId, scope.workspaceId).run();
	if (!result.meta?.changes) throw new Error('mission_runtime_compensation_state_invalid');
	return true;
}
// Only an independently-observed compensation (state='observed', i.e. beginCompensation ->
// dispatchCompensation -> observeCompensation already happened) may be finalized -- mirrors
// the executor/verifier separation in finalizeVerifiedOutcome: the caller cannot skip straight
// from 'pending' to a final verdict.
async function verifyAndCompleteCompensation(c, scope, { compensationId, missionId, runId, fencingToken, expectedVersion, verificationResult, verified, evidenceIds = [] }) {
	const compensation = await c.env.db.prepare('SELECT * FROM mission_runtime_compensations WHERE id=?1').bind(compensationId).first(); assertScope(compensation, scope);
	if (compensation.state !== 'observed') throw new Error('mission_runtime_compensation_verification_conflict');
	const mission = await c.env.db.prepare('SELECT * FROM mission_runtime_missions WHERE id=?1').bind(missionId).first(); assertScope(mission, scope);
	if (mission.state !== 'compensating' || !same(mission.version, expectedVersion)) throw new Error('mission_runtime_compensation_conflict');
	await getRun(c, scope, runId, fencingToken);
	const finalCompensationState = verified ? 'verified' : 'failed';
	const nextMissionState = verified ? 'compensated' : 'failed';
	assertTransition('mission', 'compensating', nextMissionState);
	const compResult = await c.env.db.prepare(`UPDATE mission_runtime_compensations SET state=?2,verification_result=?3,evidence_ids_json=?4,completed_at=CURRENT_TIMESTAMP,final_state=?5 WHERE id=?1 AND tenant_id=?6 AND workspace_id=?7 AND state='observed'`).bind(compensationId, finalCompensationState, JSON.stringify(verificationResult ?? null), JSON.stringify(evidenceIds), nextMissionState, scope.tenantId, scope.workspaceId).run();
	if (!compResult.meta?.changes) throw new Error('mission_runtime_compensation_verification_conflict');
	const missionResult = await c.env.db.prepare(`UPDATE mission_runtime_missions SET state=?2,version=version+1,updated_at=CURRENT_TIMESTAMP,completed_at=CASE WHEN ?2='compensated' THEN CURRENT_TIMESTAMP ELSE completed_at END WHERE id=?1 AND tenant_id=?3 AND workspace_id=?4 AND state='compensating' AND version=?5`).bind(missionId, nextMissionState, scope.tenantId, scope.workspaceId, expectedVersion).run();
	if (!missionResult.meta?.changes) throw new Error('mission_runtime_compensation_conflict');
	await audit(c, scope, { missionId, runId, type: 'COMPENSATION_FINALIZED', from: 'compensating', to: nextMissionState, expectedVersion, fencingToken, detail: { compensation_id: compensationId, verified, final_state: nextMissionState } });
	return { compensationId, missionState: nextMissionState, compensationState: finalCompensationState };
}
async function executeReadonlyGmailProbe(c, job) {
	const input = JSON.parse(job.input_json || '{}'); const scope = { tenantId: Number(input.tenant_id), workspaceId: Number(input.workspace_id) };
	if (!Number.isInteger(scope.tenantId) || !Number.isInteger(scope.workspaceId) || !Number.isInteger(Number(input.account_id))) throw new Error('mission_runtime_job_input_invalid');
	const authority = await enterpriseAuthorityService.resolveAccountAuthority(c,{ workspaceId:scope.workspaceId, actingUserId:scope.tenantId, accountId:Number(input.account_id), capability:'account_state_visibility' });
	const account = await c.env.db.prepare(`SELECT a.account_id,a.user_id,a.provider,a.sync_status,a.oauth_authorization_generation,a.last_successful_sync_at,a.last_provider_checkpoint_at,f.provider_connected,f.oauth_valid,f.sync_health,f.provider_status,f.credential_reference_id,f.credential_generation FROM account a LEFT JOIN gmail_provider_freshness f ON f.account_id=a.account_id AND f.user_id=a.user_id WHERE a.account_id=?1 AND lower(a.provider)='gmail'`).bind(Number(input.account_id)).first();
	if (!account) throw new Error('mission_runtime_authorized_gmail_not_found');
	const root = `readonly-gmail-${job.id}`; const missionId = `${root}-mission`, runId = `${root}-run`, stepId = `${root}-step`, actionId = `${root}-action`, toolId = `${root}-tool`, evidenceId = `${root}-evidence`, claimId = `${root}-claim`;
	const healthy = Boolean(account.last_successful_sync_at && account.last_provider_checkpoint_at && Number(account.provider_connected) === 1 && Number(account.oauth_valid) === 1 && account.provider_status === 'synced');
	const requestHash = await hash({ account_id: account.account_id, operation: 'freshness_checkpoint_read_v1' });
	const decision = decideProviderAction({ scopeValid: authority.allowed, identityValid: authority.allowed, credentialStatus: account.sync_status === 'needs_reconnect' ? 'missing' : Number(account.oauth_valid) === 1 ? 'active' : 'invalid', credentialGenerationValid: !account.credential_generation || Number(account.credential_generation) === Number(account.oauth_authorization_generation), authorityStatus: authority.allowed && Number(account.provider_connected) === 1 ? 'active' : 'missing', capabilities: [{ key: 'provider_state_read', status: healthy ? 'supported' : account.sync_status === 'needs_reconnect' ? 'unknown' : 'unsupported', expiresAt: new Date(Date.now() + 900000).toISOString() }], requirement: { requiredCapabilities: ['provider_state_read'], approvalRequired: false, allowDegraded: false }, paramsValid: true, fencingValid: true });
	if (!authority.allowed) decision.reasonCodes = [...new Set([...decision.reasonCodes,authority.reason])];
	const resultHash = await hash({ account_id: account.account_id, healthy, has_successful_sync: Boolean(account.last_successful_sync_at), has_checkpoint: Boolean(account.last_provider_checkpoint_at), provider_status: account.provider_status || 'unknown' });
	const evidenceHash = await hash({ job_id: job.id, account_id: account.account_id, resultHash });
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_missions(id,tenant_id,workspace_id,user_id,kind,state,idempotency_key,claim_key) VALUES(?1,?2,?3,?4,'GMAIL_READONLY_FRESHNESS_PROBE','runnable',?5,'gmail_authority_freshness_checkpoint_verified')`).bind(missionId, scope.tenantId, scope.workspaceId, scope.tenantId, `job:${job.id}`).run();
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_runs(id,mission_id,tenant_id,workspace_id,state) VALUES(?1,?2,?3,?4,'runnable')`).bind(runId, missionId, scope.tenantId, scope.workspaceId).run();
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_steps(id,mission_id,run_id,tenant_id,workspace_id,step_key,state) VALUES(?1,?2,?3,?4,?5,'read_existing_freshness','runnable')`).bind(stepId, missionId, runId, scope.tenantId, scope.workspaceId).run();
	const run = await claimRun(c, scope, runId);
	await c.env.db.prepare(`UPDATE mission_runtime_missions SET state='running',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND state='runnable'`).bind(missionId, scope.tenantId, scope.workspaceId).run();
	await c.env.db.prepare(`UPDATE mission_runtime_steps SET state='running',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND run_id=?2 AND state='runnable'`).bind(stepId, runId).run();
	const policyId = 'gmail_freshness_checkpoint_v1'; const policyRequired = JSON.stringify(['provider_observation']);
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_verification_policies(id,version,claim_type,required_evidence_json,freshness_seconds,minimum_distinct_evidence,conflict_mode,policy_hash) VALUES(?1,1,'gmail_authority_freshness_checkpoint',?2,900,1,'reject',?3)`).bind(policyId, policyRequired, await hash({ id: policyId, version: 1, required: ['provider_observation'], freshness_seconds: 900, conflict: 'reject' })).run();
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_claims(id,mission_id,run_id,step_id,action_id,tenant_id,workspace_id,claim_key,claim_type,subject_hash,assertion_hash,required_evidence_json,policy_id,policy_version) VALUES(?1,?2,?3,?4,?5,?6,?7,'gmail_authority_freshness_checkpoint_verified','gmail_authority_freshness_checkpoint',?8,?9,?10,?11,1)`).bind(claimId, missionId, runId, stepId, actionId, scope.tenantId, scope.workspaceId, await hash(`account:${account.account_id}`), await hash({ healthy: true, operation: 'freshness_checkpoint_read_v1' }), policyRequired, policyId).run();
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_actions(id,mission_id,run_id,step_id,tenant_id,workspace_id,capability,action_type,target_hash,params_hash,authority_generation,authority_context_hash,state,idempotency_key) VALUES(?1,?2,?3,?4,?5,?6,'gmail_freshness_read','READ_ONLY_PROVIDER_STATE',?7,?8,?9,?10,'dispatch_pending',?11)`).bind(actionId, missionId, runId, stepId, scope.tenantId, scope.workspaceId, await hash(`account:${account.account_id}`), requestHash, Number(authority.authorityGeneration || 0), await hash({ provider: 'gmail', operation: 'read_only', authority_reason:authority.reason, delegation_id:authority.delegationId||null }), `job:${job.id}:action`).run();
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_action_requirements(id,version,action_type,required_capabilities_json,required_authority_json,approval_required,policy_required,risk_level,verification_required,allow_degraded,blocked_state) VALUES('provider_state_read_v1',1,'READ_ONLY_PROVIDER_STATE','["provider_state_read"]','["provider_state_read"]',0,1,'read_only',1,0,'blocked')`).run();
	const decisionId = `${root}-decision`; const decisionExpiry = new Date(Date.now() + 900000).toISOString();
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_provider_decisions(id,tenant_id,workspace_id,mission_id,run_id,action_id,provider,account_id,acting_identity_hash,requirement_id,requirement_version,params_hash,authorization_generation,credential_reference_hash,result,reason_codes_json,evidence_set_hash,adapter_version,runtime_version,fencing_token,decided_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,'gmail',?7,?8,'provider_state_read_v1',1,?9,?10,?11,?12,?13,?14,'gmail_adapter_v1',?15,?16,CURRENT_TIMESTAMP,?17)`).bind(decisionId, scope.tenantId, scope.workspaceId, missionId, runId, actionId, account.account_id, await hash(`user:${scope.tenantId}`), requestHash, Number(authority.authorityGeneration || 0), await hash({ credential_reference_id: account.credential_reference_id || null, generation: account.credential_generation || 0 }), decision.result, JSON.stringify(decision.reasonCodes), await hash({ healthy, decision: decision.result, authority_reason:authority.reason }), 1, run.fencing_token, decisionExpiry).run();
	if (!decision.providerToolPermitted) {
		const terminal = decision.result === 'needs_reconnect' ? 'blocked' : 'blocked';
		await c.env.db.prepare(`UPDATE mission_runtime_actions SET state=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?3 AND workspace_id=?4`).bind(actionId, terminal, scope.tenantId, scope.workspaceId).run();
		await c.env.db.prepare(`UPDATE mission_runtime_missions SET state='blocked',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND state='running'`).bind(missionId, scope.tenantId, scope.workspaceId).run();
		await audit(c, scope, { missionId, runId, stepId, actionId, type: 'DISPATCH_DENIED', to: terminal, fencingToken: run.fencing_token, detail: { decision_id: decisionId, result: decision.result, reason_codes: decision.reasonCodes, authority_reason:authority.reason, next_action: authority.allowed ? (decision.result === 'needs_reconnect' ? 'reconnect' : 'resolve_provider_blocker') : 'request_legitimate_membership_or_account_delegation', durable_recovery_action:true, provider_tool_called:false } });
		return { missionId, verified: false, accountId: account.account_id, decision: decision.result };
	}
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_tool_calls(id,mission_id,run_id,step_id,action_id,tenant_id,workspace_id,tool_name,operation,state,request_hash,result_hash,completed_at) VALUES(?1,?2,?3,?4,?5,?6,?7,'gmail_freshness_contract','read_existing_authority_freshness_checkpoint','succeeded',?8,?9,CURRENT_TIMESTAMP)`).bind(toolId, missionId, runId, stepId, actionId, scope.tenantId, scope.workspaceId, requestHash, resultHash).run();
	await c.env.db.prepare(`UPDATE mission_runtime_actions SET state='completed',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='dispatch_pending'`).bind(actionId).run();
	const observedAt = new Date().toISOString(); const expiresAt = new Date(Date.now() + 900000).toISOString(); const summary = JSON.stringify({ account_id: account.account_id, provider: 'gmail', read_only: true, has_last_successful_sync: Boolean(account.last_successful_sync_at), has_provider_checkpoint: Boolean(account.last_provider_checkpoint_at), provider_status: account.provider_status || 'unknown' });
	const integrityHash = await integrityEnvelope({ id: evidenceId, mission_id: missionId, run_id: runId, step_id: stepId, action_id: actionId, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, claim_key: 'gmail_authority_freshness_checkpoint_verified', evidence_type: 'provider_observation', source_type: 'gmail_provider_freshness', producer_type: 'controlled_system', producer_id_hash: await hash('gmail_freshness_contract'), reference_hash: evidenceHash, summary_json: summary, observed_at: observedAt, expires_at: expiresAt });
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_evidence(id,mission_id,run_id,step_id,action_id,tenant_id,workspace_id,claim_key,source_type,status,reference_hash,summary_json,observed_at,expires_at,evidence_type,producer_type,producer_id_hash,integrity_hash,sensitivity,retention_class,valid_from,valid_until) VALUES(?1,?2,?3,?4,?5,?6,?7,'gmail_authority_freshness_checkpoint_verified','gmail_provider_freshness','${healthy ? 'supported' : 'insufficient'}',?8,?9,?10,?11,'provider_observation','controlled_system',?12,?13,'restricted_metadata','runtime_audit',?10,?11)`).bind(evidenceId, missionId, runId, stepId, actionId, scope.tenantId, scope.workspaceId, evidenceHash, summary, observedAt, expiresAt, await hash('gmail_freshness_contract'), integrityHash).run();
	const step = await c.env.db.prepare('SELECT * FROM mission_runtime_steps WHERE id=?1').bind(stepId).first(); await checkpoint(c, scope, { stepId, runId, fencingToken: run.fencing_token, expectedVersion: step.version, evidenceId });
	const mission = await c.env.db.prepare('SELECT * FROM mission_runtime_missions WHERE id=?1').bind(missionId).first();
	await c.env.db.prepare(`UPDATE mission_runtime_missions SET state='verification_pending',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='running'`).bind(missionId).run();
	const pending = await c.env.db.prepare('SELECT * FROM mission_runtime_missions WHERE id=?1').bind(missionId).first();
	const verification = await verifyClaim(c, scope, { claimId, runId, actionId });
	if (verification.state === 'verified') await finalizeVerifiedOutcome(c, scope, { missionId, runId, actionId, claimId, verificationId: verification.verificationId, expectedVersion: pending.version, fencingToken: run.fencing_token });
	else await audit(c, scope, { missionId, runId, type: 'MISSION_VERIFICATION_NOT_SATISFIED', from: pending.state, to: pending.state, expectedVersion: pending.version, fencingToken: run.fencing_token, detail: { verification_state: verification.state } });
	return { missionId, verified: healthy, accountId: account.account_id };
}
async function executeOutboundBoundaryProbe(c, job) {
	const input = JSON.parse(job.input_json || '{}'); const scope = { tenantId: Number(input.tenant_id), workspaceId: Number(input.workspace_id) };
	if (!Number.isInteger(scope.tenantId) || !Number.isInteger(scope.workspaceId)) throw new Error('mission_runtime_job_input_invalid');
	const member = await c.env.db.prepare('SELECT role FROM workspace_members WHERE workspace_id=?1 AND user_id=?2').bind(scope.workspaceId, scope.tenantId).first(); if (!member) throw new Error('mission_runtime_workspace_membership_required');
	const root = `outbound-boundary-${job.id}`, missionId = `${root}-mission`, runId = `${root}-run`, stepId = `${root}-step`, actionId = `${root}-action`;
	const paramsHash = await hash({ operation: 'outbound_send', boundary_test: true }); const authorityHash = await hash({ provider: 'none', boundary: 'approval_required' });
	await c.env.db.prepare(`INSERT INTO mission_runtime_missions(id,tenant_id,workspace_id,user_id,kind,state,idempotency_key,claim_key) VALUES(?1,?2,?3,?4,'OUTBOUND_APPROVAL_BOUNDARY_PROBE','waiting_for_approval',?5,'outbound_business_result_verified')`).bind(missionId, scope.tenantId, scope.workspaceId, scope.tenantId, `job:${job.id}`).run();
	await c.env.db.prepare(`INSERT INTO mission_runtime_runs(id,mission_id,tenant_id,workspace_id,state) VALUES(?1,?2,?3,?4,'runnable')`).bind(runId, missionId, scope.tenantId, scope.workspaceId).run();
	await c.env.db.prepare(`INSERT INTO mission_runtime_steps(id,mission_id,run_id,tenant_id,workspace_id,step_key,state) VALUES(?1,?2,?3,?4,?5,'approval_boundary','runnable')`).bind(stepId, missionId, runId, scope.tenantId, scope.workspaceId).run();
	await c.env.db.prepare(`INSERT INTO mission_runtime_actions(id,mission_id,run_id,step_id,tenant_id,workspace_id,capability,action_type,target_hash,params_hash,authority_generation,authority_context_hash,state,idempotency_key) VALUES(?1,?2,?3,?4,?5,?6,'outbound_send','OUTBOUND_SEND_BOUNDARY',?7,?8,0,?9,'waiting_for_approval',?10)`).bind(actionId, missionId, runId, stepId, scope.tenantId, scope.workspaceId, await hash('no-recipient'), paramsHash, authorityHash, `job:${job.id}:action`).run();
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_action_requirements(id,version,action_type,required_capabilities_json,required_authority_json,approval_required,policy_required,risk_level,verification_required,allow_degraded,blocked_state) VALUES('outbound_send_v1',1,'OUTBOUND_SEND_BOUNDARY','["outbound_send"]','["outbound_send"]',1,1,'external_write',1,0,'waiting_for_approval')`).run();
	const decisionId = `${root}-decision`;
	await c.env.db.prepare(`INSERT INTO mission_runtime_provider_decisions(id,tenant_id,workspace_id,mission_id,run_id,action_id,provider,account_id,acting_identity_hash,requirement_id,requirement_version,params_hash,authorization_generation,credential_reference_hash,result,reason_codes_json,evidence_set_hash,adapter_version,runtime_version,fencing_token,decided_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,'provider_agnostic',0,?7,'outbound_send_v1',1,?8,0,?9,'approval_required','["exact_approval_missing"]',?10,'control_plane_v1',1,0,CURRENT_TIMESTAMP,datetime('now','+15 minutes'))`).bind(decisionId, scope.tenantId, scope.workspaceId, missionId, runId, actionId, await hash(`user:${scope.tenantId}`), paramsHash, await hash('no-credential-access'), await hash({ approval: false, outbound: false })).run();
	await audit(c, scope, { missionId, runId, stepId, actionId, type: 'OUTBOUND_ACTION_WAITING_FOR_APPROVAL', to: 'waiting_for_approval', detail: { exact_approval_present: false, outbound_link_created: false, send_tool_called: false } });
	return { missionId, actionId, state: 'waiting_for_approval' };
}
async function executePolicyDenialProbe(c, job) {
	const input = JSON.parse(job.input_json || '{}'); const scope = { tenantId: Number(input.tenant_id), workspaceId: Number(input.workspace_id) };
	const member = await c.env.db.prepare('SELECT role FROM workspace_members WHERE workspace_id=?1 AND user_id=?2').bind(scope.workspaceId, scope.tenantId).first(); if (!member) throw new Error('mission_runtime_workspace_membership_required');
	const root = `policy-denial-${job.id}`, missionId = `${root}-mission`, runId = `${root}-run`, stepId = `${root}-step`, actionId = `${root}-action`, decisionId = `${root}-decision`; const paramsHash = await hash({ operation: 'controlled_policy_denial' });
	await c.env.db.prepare(`INSERT INTO mission_runtime_missions(id,tenant_id,workspace_id,user_id,kind,state,idempotency_key,claim_key) VALUES(?1,?2,?3,?4,'CONTROLLED_POLICY_DENIAL_PROBE','blocked',?5,'policy_denied')`).bind(missionId, scope.tenantId, scope.workspaceId, scope.tenantId, `job:${job.id}`).run();
	await c.env.db.prepare(`INSERT INTO mission_runtime_runs(id,mission_id,tenant_id,workspace_id,state) VALUES(?1,?2,?3,?4,'runnable')`).bind(runId, missionId, scope.tenantId, scope.workspaceId).run();
	await c.env.db.prepare(`INSERT INTO mission_runtime_steps(id,mission_id,run_id,tenant_id,workspace_id,step_key,state) VALUES(?1,?2,?3,?4,?5,'policy_gate','runnable')`).bind(stepId, missionId, runId, scope.tenantId, scope.workspaceId).run();
	await c.env.db.prepare(`INSERT INTO mission_runtime_actions(id,mission_id,run_id,step_id,tenant_id,workspace_id,capability,action_type,target_hash,params_hash,authority_generation,authority_context_hash,state,idempotency_key) VALUES(?1,?2,?3,?4,?5,?6,'controlled_external_write','POLICY_DENIAL_BOUNDARY',?7,?8,0,?9,'blocked',?10)`).bind(actionId, missionId, runId, stepId, scope.tenantId, scope.workspaceId, await hash('controlled-target'), paramsHash, await hash('policy_denial'), `job:${job.id}:action`).run();
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_action_requirements(id,version,action_type,required_capabilities_json,required_authority_json,approval_required,policy_required,risk_level,verification_required,allow_degraded,blocked_state) VALUES('controlled_policy_denial_v1',1,'POLICY_DENIAL_BOUNDARY','["controlled_external_write"]','["controlled_external_write"]',0,1,'external_write',1,0,'blocked')`).run();
	await c.env.db.prepare(`INSERT INTO mission_runtime_provider_decisions(id,tenant_id,workspace_id,mission_id,run_id,action_id,provider,account_id,acting_identity_hash,requirement_id,requirement_version,params_hash,authorization_generation,credential_reference_hash,result,reason_codes_json,evidence_set_hash,adapter_version,runtime_version,fencing_token,decided_at,expires_at) VALUES(?1,?2,?3,?4,?5,?6,'provider_agnostic',0,?7,'controlled_policy_denial_v1',1,?8,0,?9,'policy_denied','["controlled_production_policy_denied"]',?10,'control_plane_v1',1,0,CURRENT_TIMESTAMP,datetime('now','+15 minutes'))`).bind(decisionId, scope.tenantId, scope.workspaceId, missionId, runId, actionId, await hash(`user:${scope.tenantId}`), paramsHash, await hash('no-credential-access'), await hash({ source: 'policy', denied: true })).run();
	await audit(c, scope, { missionId, runId, stepId, actionId, type: 'DISPATCH_DENIED', to: 'blocked', detail: { decision_id: decisionId, result: 'policy_denied', blocker_source: 'policy-derived', provider_tool_called: false } }); return { missionId, state: 'blocked' };
}
async function monitorScheduled({ env }, options = {}) {
	const c = { env }; const limit = Math.max(1, Math.min(10, Number(options.limit || 2)));
	const jobs = await env.db.prepare(`SELECT id,user_id,input_json,attempt_count,job_type FROM nexora_autonomy_jobs WHERE job_type IN ('MISSION_RUNTIME_READONLY_PROBE','MISSION_RUNTIME_OUTBOUND_BOUNDARY_PROBE','MISSION_RUNTIME_POLICY_DENIAL_PROBE') AND (state IN ('QUEUED','RETRYING') OR (state='RUNNING' AND lease_until<CURRENT_TIMESTAMP)) AND (next_attempt_at IS NULL OR next_attempt_at<=CURRENT_TIMESTAMP) ORDER BY id LIMIT ?1`).bind(limit).all();
	let claimed = 0, succeeded = 0, retried = 0;
	for (const job of jobs.results || []) {
		const claim = await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='RUNNING',attempt_count=attempt_count+1,lease_until=datetime('now','+2 minutes'),updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND job_type IN ('MISSION_RUNTIME_READONLY_PROBE','MISSION_RUNTIME_OUTBOUND_BOUNDARY_PROBE','MISSION_RUNTIME_POLICY_DENIAL_PROBE') AND (state IN ('QUEUED','RETRYING') OR (state='RUNNING' AND lease_until<CURRENT_TIMESTAMP))`).bind(job.id).run(); if (!claim.meta?.changes) continue; claimed += 1;
		try { const result = job.job_type === 'MISSION_RUNTIME_OUTBOUND_BOUNDARY_PROBE' ? await executeOutboundBoundaryProbe(c, job) : job.job_type === 'MISSION_RUNTIME_POLICY_DENIAL_PROBE' ? await executePolicyDenialProbe(c, job) : await executeReadonlyGmailProbe(c, job); await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='SUCCEEDED',lease_until=NULL,blocker_code=NULL,result_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='RUNNING'`).bind(job.id, JSON.stringify({ runtime_mission_id: result.missionId, verified: result.verified === true, state: result.state || null, destructive: false, external_communication: false })).run(); succeeded += 1; }
		catch (error) { await env.db.prepare(`UPDATE nexora_autonomy_jobs SET state='FAILED',lease_until=NULL,blocker_code='MISSION_RUNTIME_READONLY_FAILED',result_json=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND state='RUNNING'`).bind(job.id, JSON.stringify({ executed: false, destructive: false, error: safeError(error) })).run(); }
	}
	return { checked: (jobs.results || []).length, claimed, succeeded, retried, bounded: true };
}
export { STATES, allowed, assertTransition, hash, stable, evaluateEvidence, evaluateVerifiedActionBoundary, beginCompensation, dispatchCompensation, observeCompensation, verifyAndCompleteCompensation };
export { resolveNexoraCallbackLineage, finalizeNexoraCallbackVerifiedOutcome };
export default { STATES, allowed, assertTransition, claimRun, checkpoint, consumeApproval, complete, verifyClaim, finalizeVerifiedOutcome, finalizeNexoraCallbackVerifiedOutcome, monitorScheduled, evaluateEvidence, evaluateVerifiedActionBoundary, beginCompensation, dispatchCompensation, observeCompensation, verifyAndCompleteCompensation, resolveNexoraCallbackLineage };
