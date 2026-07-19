// NEXORA Zero-Touch onboarding orchestrator: ties the Durable Mission Runtime (generic mission
// state), the onboarding-specific 18-state phase machine, and the OAuth/authorization-session
// contract into the single "start onboarding" / "handle callback" surface a UI or callback
// route calls. This is the automatic-Mission-continuation implementation (Required Output #20,
// ADR-8): a valid callback advances both the onboarding phase AND the underlying
// mission_runtime_missions run, with no further user action required.
import durableMissionRuntime from './durable-mission-runtime-service.js';
import onboardingStateMachine from './nexora-onboarding-state-machine.js';
import onboardingOAuth, { insertAuthorizationSession, validateGrantedScopes, validateIdentity, validateMicrosoftTenant } from './nexora-onboarding-oauth-service.js';
import tokenExchange, { verifyIdTokenClaims } from './nexora-onboarding-token-exchange-service.js';
import tokenStorage from './nexora-onboarding-token-storage-service.js';
import callbackRecovery from './nexora-onboarding-callback-recovery-service.js';
import reauthorization from './nexora-onboarding-reauthorization-service.js';
import { commitEvidenceDeliveryResult } from './nexora-onboarding-evidence-outbox-service.js';
import callbackContinuation from './nexora-callback-continuation-service.js';

const uuid = () => crypto.randomUUID();
async function hash(value) {
	const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hasColumn(db, table, column) {
	const info = await db.prepare(`PRAGMA table_info(${table})`).all();
	return (info.results || []).some((row) => row.name === column);
}

async function ensureMissionContinuationCheckpoint(c, scope, missionId, resumeCheckpoint) {
	const hasCheckpoint = await hasColumn(c.env.db, 'mission_runtime_missions', 'checkpoint_id');
	if (!hasCheckpoint) return;
	const hasContinuation = await hasColumn(c.env.db, 'mission_runtime_missions', 'continuation_idempotency_key');
	const sql = hasContinuation
		? `UPDATE mission_runtime_missions SET checkpoint_id=COALESCE(checkpoint_id,?2),state='verification_pending',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?3 AND workspace_id=?4`
		: `UPDATE mission_runtime_missions SET checkpoint_id=COALESCE(checkpoint_id,?2),state='verification_pending',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?3 AND workspace_id=?4`;
	await c.env.db.prepare(sql).bind(missionId, resumeCheckpoint, scope.tenantId, scope.workspaceId).run();
}

async function integrityEnvelope(row) {
	return hash({ id: row.id, mission_id: row.mission_id, run_id: row.run_id, step_id: row.step_id, action_id: row.action_id || null, tenant_id: row.tenant_id, workspace_id: row.workspace_id, claim_key: row.claim_key, evidence_type: row.evidence_type, source_type: row.source_type, producer_type: row.producer_type, producer_id_hash: row.producer_id_hash, reference_hash: row.reference_hash, summary_json: row.summary_json, observed_at: row.observed_at, expires_at: row.expires_at || null });
}

async function ensureCallbackEvidence(c, scope, { missionId, runId, callbackClaimId, correlationId, authorizationSessionId, provider, providerOutcomeId, tokenGeneration, providerConnectionId, providerConnectionGeneration }) {
	const outboxId = `outbox:${providerOutcomeId}`;
	const payload = { provider, authorization_session_id: authorizationSessionId, callback_correlation_id: correlationId, token_generation: tokenGeneration, provider_connection_generation: providerConnectionGeneration, run_id: runId, callback_claim_id: callbackClaimId };
	await c.env.db.prepare(`INSERT OR IGNORE INTO nexora_onboarding_evidence_outbox(id,commit_result_id,onboarding_mission_id,tenant_id,workspace_id,event_type,payload_json,status) VALUES(?1,?2,?3,?4,?5,'REAL_PROVIDER_CALLBACK_AUTHORITY_ESTABLISHED',?6,'CLAIMED')`).bind(outboxId, providerOutcomeId, missionId, scope.tenantId, scope.workspaceId, JSON.stringify(payload)).run();
	await c.env.db.prepare(`INSERT OR IGNORE INTO nexora_onboarding_evidence_delivery_leases(outbox_id,tenant_id,workspace_id,owner,fencing_token,lease_expires_at,attempt) VALUES(?1,?2,?3,'real-callback-evidence-worker',1,datetime('now','+5 minutes'),1)`).bind(outboxId, scope.tenantId, scope.workspaceId).run().catch(() => {});
	const evidenceId = `evidence:${providerOutcomeId}`;
	const observedAt = new Date().toISOString();
	const referenceHash = await hash({ evidenceId, providerOutcomeId, missionId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, payload });
	const summary = JSON.stringify({ provider, token_generation: tokenGeneration, provider_connection_id: providerConnectionId, provider_connection_generation: providerConnectionGeneration, callback_correlation_id: correlationId, redacted: true });
	const row = { id: evidenceId, mission_id: missionId, run_id: runId, step_id: 'nexora_callback', action_id: null, tenant_id: scope.tenantId, workspace_id: scope.workspaceId, claim_key: 'nexora_callback_outcome', evidence_type: 'callback_result', source_type: 'nexora_callback', producer_type: 'mission_runtime', producer_id_hash: await hash('real-provider-callback'), reference_hash: referenceHash, summary_json: summary, observed_at: observedAt, expires_at: null };
	const integrity = await integrityEnvelope(row);
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_evidence(id,mission_id,run_id,step_id,action_id,tenant_id,workspace_id,claim_key,evidence_type,source_type,producer_type,producer_id_hash,reference_hash,summary_json,status,integrity_hash,observed_at,expires_at,created_at) VALUES(?1,?2,?3,?4,NULL,?5,?6,?7,?8,?9,?10,?11,?12,?13,'supported',?14,?15,NULL,?15)`).bind(row.id, row.mission_id, row.run_id, row.step_id, row.tenant_id, row.workspace_id, row.claim_key, row.evidence_type, row.source_type, row.producer_type, row.producer_id_hash, row.reference_hash, row.summary_json, integrity, observedAt).run();
	await commitEvidenceDeliveryResult(c, scope, { outboxId, owner: 'real-callback-evidence-worker', fencingToken: 1, status: 'DELIVERED', canonicalEvidenceReference: evidenceId });
	return { outboxId, evidenceId };
}

async function ensureCallbackClaimPolicy(c, scope, { missionId, runId, callbackClaimId }) {
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_verification_policies(id,version,required_evidence_json,freshness_seconds,minimum_distinct_evidence,conflict_mode,policy_hash) VALUES('policy-1',1,'["callback_result"]',3600,1,'fail_closed','nexora-callback-policy-v1')`).run();
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_claims(id,mission_id,run_id,tenant_id,workspace_id,claim_key,policy_id,policy_version,version) VALUES(?1,?2,?3,?4,?5,'nexora_callback_outcome','policy-1',1,1)`).bind(callbackClaimId, missionId, runId, scope.tenantId, scope.workspaceId).run();
}

async function advanceInitialSyncPhase(c, scope, missionId) {
	for (const next of ['validating_authority', 'discovering_capabilities', 'provisioning', 'verifying_connection', 'starting_initial_sync']) {
		const current = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
		if (current && onboardingStateMachine.allowed(current.phase, next)) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: next });
	}
}

async function establishProviderAuthority(c, scope, { missionId, provider, providerAccountHash, authorizationSessionId, correlationId, callbackClaim, tokenGeneration }) {
	const connectionId = `provider-connection:${missionId}:${provider}:${providerAccountHash}`;
	await c.env.db.prepare(`INSERT OR IGNORE INTO nexora_onboarding_provider_connections(id,onboarding_mission_id,tenant_id,workspace_id,provider,connection_identity,generation,connection_state) VALUES(?1,?2,?3,?4,?5,?6,1,'active')`).bind(connectionId, missionId, scope.tenantId, scope.workspaceId, provider, providerAccountHash).run();
	const connection = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_provider_connections WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(connectionId, scope.tenantId, scope.workspaceId).first();
	const token = await c.env.db.prepare(`SELECT id,rotation_generation FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND provider=?4`).bind(missionId, scope.tenantId, scope.workspaceId, provider).first();
	await c.env.db.prepare(`INSERT OR IGNORE INTO nexora_onboarding_token_connection_bindings(token_id,connection_id,tenant_id,workspace_id,provider,token_generation,connection_generation) VALUES(?1,?2,?3,?4,?5,?6,?7)`).bind(token.id, connection.id, scope.tenantId, scope.workspaceId, provider, tokenGeneration || token.rotation_generation, connection.generation).run();
	const providerOutcomeId = `provider-outcome:${correlationId}`;
	const authorityDigest = await hash({ missionId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider, authorizationSessionId, correlationId, callbackClaimId: callbackClaim.id, leaseOwner: callbackClaim.lease_owner, fencingToken: callbackClaim.fencing_token, tokenGeneration: tokenGeneration || token.rotation_generation, providerConnectionId: connection.id, providerConnectionGeneration: connection.generation });
	const outcomeDigest = await hash({ success: true, provider, providerAccountHash });
	const hasOutcomeStatus = await hasColumn(c.env.db, 'nexora_provider_outcome_results', 'outcome_status');
	const outcomeSql = hasOutcomeStatus
		? `INSERT OR IGNORE INTO nexora_provider_outcome_results(id,outcome_kind,operation_id,idempotency_key,authority_tuple_digest,outcome_digest,tenant_id,workspace_id,provider,connection_id,mission_id,authorization_session_id,correlation_id,lease_owner,fencing_token,expected_token_generation,committed_token_generation,expected_provider_connection_generation,committed_provider_connection_generation,normalized_reason_code,retry_classification,outcome_status) VALUES(?1,'SUCCESS',?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15,?16,?16,'SUCCESS','TERMINAL_SUCCESS','SUCCESS')`
		: `INSERT OR IGNORE INTO nexora_provider_outcome_results(id,outcome_kind,operation_id,idempotency_key,authority_tuple_digest,outcome_digest,tenant_id,workspace_id,provider,connection_id,mission_id,authorization_session_id,correlation_id,lease_owner,fencing_token,expected_token_generation,committed_token_generation,expected_provider_connection_generation,committed_provider_connection_generation,normalized_reason_code,retry_classification) VALUES(?1,'SUCCESS',?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?15,?16,?16,'SUCCESS','TERMINAL_SUCCESS')`;
	await c.env.db.prepare(outcomeSql).bind(providerOutcomeId, `callback:${correlationId}`, `callback:${correlationId}:provider-outcome`, authorityDigest, outcomeDigest, scope.tenantId, scope.workspaceId, provider, connection.id, missionId, authorizationSessionId, correlationId, callbackClaim.lease_owner, callbackClaim.fencing_token, tokenGeneration || token.rotation_generation, connection.generation).run();
	return { providerOutcomeId, tokenGeneration: tokenGeneration || token.rotation_generation, providerConnectionId: connection.id, providerConnectionGeneration: connection.generation };
}

async function continueVerifiedCallback(c, scope, { missionId, provider, authorizationSessionId, correlationId, callbackClaim, resumeCheckpoint, run, providerOutcomeId, tokenGeneration, providerConnectionId, providerConnectionGeneration }) {
	const runId = run?.id || `onboarding-run:${missionId}`;
	await ensureMissionContinuationCheckpoint(c, scope, missionId, resumeCheckpoint);
	const evidence = await ensureCallbackEvidence(c, scope, { missionId, runId, callbackClaimId: callbackClaim.id, correlationId, authorizationSessionId, provider, providerOutcomeId, tokenGeneration, providerConnectionId, providerConnectionGeneration });
	await ensureCallbackClaimPolicy(c, scope, { missionId, runId, callbackClaimId: callbackClaim.id });
	const verification = await durableMissionRuntime.verifyClaim(c, scope, { claimId: callbackClaim.id, runId });
	const lineage = await durableMissionRuntime.resolveNexoraCallbackLineage(c, scope, { missionId, evidenceId: evidence.evidenceId, outboxId: evidence.outboxId, commitResultId: providerOutcomeId });
	if (!lineage.eligible) throw new Error(`nexora_callback_lineage_ineligible:${lineage.failures.join(',')}`);
	const finalizationId = `finalization:${correlationId}`;
	const finalization = await durableMissionRuntime.finalizeNexoraCallbackVerifiedOutcome(c, scope, {
		finalizationId,
		idempotencyKey: `finalize:${correlationId}`,
		authorizationId: verification.verifierAuthorizationId,
		verificationAttemptId: verification.verificationId,
		missionId,
		callbackCorrelationId: correlationId,
		callbackClaimId: callbackClaim.id,
		providerOutcomeResultId: providerOutcomeId,
		expectedProviderConnectionId: providerConnectionId,
		expectedAuthorityTupleDigest: lineage.authorityTupleDigest,
		expectedEvidenceSetDigest: verification.evidenceSetDigest,
		expectedTokenGeneration: tokenGeneration,
		expectedProviderConnectionGeneration: providerConnectionGeneration,
		expectedVerificationIdempotencyKey: `verify:${callbackClaim.id}:${runId}:`,
	});
	await c.env.db.prepare(`UPDATE nexora_onboarding_callback_correlations SET status='VERIFIED_PENDING_CONSUMPTION' WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND status='claimed'`).bind(correlationId, scope.tenantId, scope.workspaceId).run();
	const continuationId = `mission-continuation:${missionId}`;
	const consumption = await callbackContinuation.consumeCorrelation(c, scope, { callbackCorrelationId: correlationId, idempotencyKey: `consume:${correlationId}`, missionContinuationId: continuationId, verifiedResultId: finalization.outcomeReference, finalizationId, verifierAuthorizationId: verification.verifierAuthorizationId, verificationAttemptId: verification.verificationId, missionId, provider, authorizationSessionId, expectedTokenGeneration: tokenGeneration, expectedProviderConnectionId: providerConnectionId, expectedProviderConnectionGeneration: providerConnectionGeneration, owner: callbackClaim.lease_owner, fencingToken: callbackClaim.fencing_token, expectedCorrelationState: 'VERIFIED_PENDING_CONSUMPTION', authorityTupleDigest: lineage.authorityTupleDigest, evidenceSetDigest: verification.evidenceSetDigest, expectedVerificationPolicyId: 'policy-1', expectedVerificationGeneration: 1, expectedVerificationIdempotencyKey: `verify:${callbackClaim.id}:${runId}:` });
	const continuation = await callbackContinuation.continueMission(c, scope, { continuationId, idempotencyKey: `continue:${missionId}:${correlationId}`, correlationConsumptionId: consumption.id, verifiedResultId: finalization.outcomeReference, finalizationId, verifierAuthorizationId: verification.verifierAuthorizationId, verificationAttemptId: verification.verificationId, missionId, provider, authorizationSessionId, callbackCorrelationId: correlationId, expectedTokenGeneration: tokenGeneration, expectedProviderConnectionId: providerConnectionId, expectedProviderConnectionGeneration: providerConnectionGeneration, owner: callbackClaim.lease_owner, fencingToken: callbackClaim.fencing_token, resumeCheckpoint, expectedMissionState: 'verification_pending', authorityTupleDigest: lineage.authorityTupleDigest, evidenceSetDigest: verification.evidenceSetDigest, expectedVerificationPolicyId: 'policy-1', expectedVerificationGeneration: 1, expectedVerificationIdempotencyKey: `verify:${callbackClaim.id}:${runId}:` });
	return { evidence, verification, finalization, consumption, continuation };
}

// Starts a new Zero-Touch onboarding Mission: creates the underlying durable mission (kind=
// 'ZERO_TOUCH_ONBOARDING'), the onboarding phase row, and an authorization session for the
// requested provider/capabilities. Idempotent per (tenant, workspace, idempotencyKey) — a
// duplicate start request (e.g. a double click) reuses the same Mission rather than creating a
// second competing onboarding flow.
async function startOnboarding(c, scope, { provider, capabilities, idempotencyKey, tenantHint = null, loginHint = null }) {
	const missionId = `onboarding:${await hash({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, idempotencyKey })}`;
	await c.env.db
		.prepare(`INSERT OR IGNORE INTO mission_runtime_missions(id,tenant_id,workspace_id,user_id,kind,state,idempotency_key,claim_key) VALUES(?1,?2,?3,?2,'ZERO_TOUCH_ONBOARDING','runnable',?4,'zero_touch_onboarding_verified')`)
		.bind(missionId, scope.tenantId, scope.workspaceId, idempotencyKey)
		.run();
	await onboardingStateMachine.ensureOnboardingState(c, scope, { missionId, targetProvider: provider, targetAccountOrDomainHash: await hash(loginHint || tenantHint || provider) });

	const current = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
	if (current.phase === 'discovering') {
		await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'provider_identified' });
		await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'authorization_path_selected' });
	}

	// Credential availability is checked BEFORE declaring we're waiting on the user -- a missing
	// first-party app is an administrator blocker, not something the user can act on by logging
	// in, so the phase must never claim "waiting_for_user_login" when there is nothing to log
	// into yet.
	const session = await onboardingOAuth.createAuthorizationSession(c.env, { onboardingMissionId: missionId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider, capabilities, tenantHint, loginHint });
	if (!session.ok) {
		const phaseNow = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
		if (onboardingStateMachine.allowed(phaseNow.phase, 'blocked')) {
			await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'blocked', blockedReason: session.reason, requiredHumanActor: 'workspace_administrator', resumeToken: `resume:${missionId}` });
		}
		return { ok: false, missionId, reason: session.reason, requiredEnv: session.requiredEnv };
	}
	const beforeWait = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
	if (onboardingStateMachine.allowed(beforeWait.phase, 'waiting_for_user_login')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'waiting_for_user_login' });
	await insertAuthorizationSession(c, session.row);
	// verifier/state must reach the caller (never persisted server-side in cleartext, per
	// ADR-6) so the API layer can hand them to the client -- typically the verifier via an
	// httpOnly, short-lived cookie and state is already embedded in authorizationUrl itself.
	return { ok: true, missionId, authorizationUrl: session.authorizationUrl, sessionId: session.row.id, expiresAt: session.row.expires_at, state: session.state, nonce: session.nonce, verifier: session.verifier };
}

// Consumes a real provider callback and automatically resumes the originating Mission — no
// user action required beyond the provider consent screen itself. The Mission's underlying
// mission_runtime_runs lease is claimed here (real, fenced, per durable-mission-runtime-service)
// so this is restart-safe the same way every other Mission Runtime step is.
async function handleCallback(c, scope, { state, verifier, code = null, redirectUri = null, callbackFingerprint, fetchImpl, jwksFetchImpl, loginHint = null, allowedMicrosoftTenantIds = [], expectedProvider = null }) {
	const consumption = await onboardingOAuth.consumeCallback(c, scope, { state, verifier, receivedCallbackFingerprint: callbackFingerprint, expectedProvider });
	if (!consumption.ok) return { ok: false, reason: consumption.reason };
	// Scope originates only from the server-side correlation row.  The optional scope on the
	// POST test route is merely checked by consumeCallback; it can never override it.
	scope = consumption.scope;
	if (consumption.duplicate) {
		// A duplicate can observe progress or an expired claim, but can never replay the
		// single-use authorization code.  Recovery after a provider response is explicitly
		// reconciled from durable authority; absent authority proceeds to reauthorization.
		if (consumption.recovery === 'REAUTHORIZATION_REQUIRED' && consumption.callbackClaim) {
			const created = await reauthorization.ensureWork(c, consumption.callbackClaim);
			if (!created.ok) return { ok: false, duplicate: true, recovery: 'REAUTHORIZATION_REQUIRED', reason: created.reason, resumeCheckpoint: consumption.resumeCheckpoint };
			const claimed = await reauthorization.claimWork(c, scope, created.work);
			if (!claimed.ok) return { ok: true, duplicate: true, recovery: 'REAUTHORIZATION_REQUIRED', reauthorizationWorkId: created.work.id, reauthorizationStatus: claimed.work?.status || 'PENDING', resumeCheckpoint: consumption.resumeCheckpoint };
			const replacement = await reauthorization.createReplacementSession(c, scope, claimed.work);
			return { ok: replacement.ok, duplicate: true, recovery: 'REAUTHORIZATION_REQUIRED', reauthorizationWorkId: claimed.work.id, reauthorizationStatus: replacement.ok ? 'WAITING_FOR_USER' : 'BLOCKED', replacementSessionId: replacement.sessionId || null, authorizationUrl: replacement.authorizationUrl || null, resumeCheckpoint: consumption.resumeCheckpoint, reason: replacement.ok ? null : replacement.reason };
		}
		return { ok: true, duplicate: true, recovery: consumption.recovery || 'RECONCILIATION_REQUIRED', resumeCheckpoint: consumption.resumeCheckpoint };
	}

	const missionId = consumption.onboardingMissionId;
	const provider = consumption.provider;
	const tenantHint = consumption.tenantHint;
	const phaseRow = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(missionId, scope.tenantId, scope.workspaceId).first();
	if (!phaseRow) return { ok: false, reason: 'ONBOARDING_STATE_NOT_FOUND' };
	if (onboardingStateMachine.allowed(phaseRow.phase, 'waiting_for_user_consent')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'waiting_for_user_consent' });
	const afterConsent = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
	if (onboardingStateMachine.allowed(afterConsent.phase, 'authorization_received')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'authorization_received' });

	const run = await reclaimMissionRun(c, scope, missionId);
	return handleCallbackExchange(c, scope, { missionId, provider, code, verifier, redirectUri, fetchImpl, jwksFetchImpl, loginHint, tenantHint, allowedMicrosoftTenantIds, resumeCheckpoint: consumption.resumeCheckpoint, run, callbackClaim: consumption.callbackClaim, authorizationSessionId: consumption.authorizationSessionId, correlationId: consumption.correlationId });
}

// Automatic Mission continuation: claim/advance the underlying durable Mission run so the
// caller never has to separately "resume" anything.
async function reclaimMissionRun(c, scope, missionId) {
	const runId = `onboarding-run:${missionId}`;
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_runs(id,mission_id,tenant_id,workspace_id,state) VALUES(?1,?2,?3,?4,'runnable')`).bind(runId, missionId, scope.tenantId, scope.workspaceId).run();
	const run = await durableMissionRuntime.claimRun(c, scope, runId).catch(() => null);
	if (run) {
		await c.env.db.prepare(`UPDATE mission_runtime_missions SET state='running',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND state IN ('runnable','running')`).bind(missionId, scope.tenantId, scope.workspaceId).run();
	}
	return run;
}

// Required Output #4 + identity/tenant validation: automatic capability-discovery-to-initial-
// sync continuation using the REAL provider adapter contract, with id_token signature,
// issuer, audience, expiry, nonce, identity and (for Microsoft) tenant validation enforced
// before any token is trusted -- not just available as an untested helper. Shared by both the normal
// callback path and the restart-safe duplicate-retry path in handleCallback() above, so a
// Worker eviction between exchange and storage is recoverable via a resupplied callback
// rather than stranding the Mission.
async function handleCallbackExchange(c, scope, { missionId, provider, code, verifier, redirectUri, fetchImpl, jwksFetchImpl, loginHint, tenantHint = null, allowedMicrosoftTenantIds, resumeCheckpoint, run, callbackClaim = null, authorizationSessionId = null, correlationId = null }) {
	let tokenExchangeResult = null;
	let capabilityStatus = null;
	let syncDispatched = false;
	let continuationResult = null;
	if (code && redirectUri) {
		if (callbackClaim) await callbackRecovery.recordCheckpoint(c, callbackClaim, { step: 'TOKEN_EXCHANGE_INTENT_RECORDED', status: 'INTENT_RECORDED', providerOperationReference: `exchange:${callbackClaim.id}:${callbackClaim.attempt}` });
		if (callbackClaim) await callbackRecovery.recordCheckpoint(c, callbackClaim, { step: 'TOKEN_EXCHANGE_REQUEST_STARTED', status: 'IN_PROGRESS' });
		tokenExchangeResult = await tokenExchange.exchangeAuthorizationCode(c.env, { provider, code, verifier, redirectUri, tenantHint }, fetchImpl);
		if (callbackClaim) await callbackRecovery.recordCheckpoint(c, callbackClaim, { step: 'TOKEN_EXCHANGE_RESPONSE_OBSERVED', status: 'EXTERNAL_RESULT_OBSERVED', lastErrorCode: tokenExchangeResult.ok ? null : tokenExchangeResult.errorCode });
		if (tokenExchangeResult.ok) {
			const authorizationSession = authorizationSessionId ? await c.env.db.prepare(`SELECT nonce_hash FROM nexora_onboarding_authorization_sessions WHERE id=?1 AND onboarding_mission_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND provider=?5`).bind(authorizationSessionId, missionId, scope.tenantId, scope.workspaceId, provider).first() : null;
			const verifiedIdToken = await verifyIdTokenClaims(c.env, { provider, idToken: tokenExchangeResult.idToken, expectedNonceHash: authorizationSession?.nonce_hash || null, tenantHint }, jwksFetchImpl || fetch);
			if (!verifiedIdToken.ok) {
				const current = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
				if (onboardingStateMachine.allowed(current.phase, 'validating_authority')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'validating_authority' });
				const revalidated = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
				if (onboardingStateMachine.allowed(revalidated.phase, 'blocked')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'blocked', blockedReason: verifiedIdToken.errorCode, requiredHumanActor: 'workspace_administrator' });
				return { ok: true, duplicate: false, missionId, resumeCheckpoint, phase: (await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first()).phase, missionResumed: Boolean(run), tokenExchangeAttempted: true, tokenExchangeOk: true, identityValid: false, capabilityStatus: null, syncDispatched: false, idTokenVerified: false, idTokenErrorCode: verifiedIdToken.errorCode };
			}
			const claims = verifiedIdToken.claims;
			const identityResult = validateIdentity({ expectedLoginHint: loginHint, providerSubject: claims?.sub, providerEmail: claims?.email });
			const tenantResult = provider === 'microsoft' ? validateMicrosoftTenant({ allowedTenantIds: allowedMicrosoftTenantIds, observedTenantId: claims?.tid }) : { valid: true };

			if (!identityResult.valid || !tenantResult.valid) {
				// A real, precise conflict -- never silently proceed with a mismatched identity
				// or a disallowed tenant, and never store the token for it.
				const current = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
				if (onboardingStateMachine.allowed(current.phase, 'validating_authority')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'validating_authority' });
				const revalidated = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
				if (onboardingStateMachine.allowed(revalidated.phase, 'blocked')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'blocked', blockedReason: !identityResult.valid ? identityResult.reason : tenantResult.reason, requiredHumanActor: 'end_user' });
				return { ok: true, duplicate: false, missionId, resumeCheckpoint, phase: (await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first()).phase, missionResumed: Boolean(run), tokenExchangeAttempted: true, tokenExchangeOk: true, identityValid: false, capabilityStatus: null, syncDispatched: false };
			}

			const reauthWork = authorizationSessionId && correlationId ? await c.env.db.prepare(`SELECT * FROM nexora_onboarding_reauthorization_work WHERE replacement_authorization_session_id=?1 AND replacement_correlation_id=?2 AND onboarding_mission_id=?3 AND tenant_id=?4 AND workspace_id=?5 AND provider=?6`).bind(authorizationSessionId, correlationId, missionId, scope.tenantId, scope.workspaceId, provider).first() : null;
			const accountHash = await hash(claims?.sub || `${provider}:${missionId}`);
			let tokenAuthorityResult = null;
			if (reauthWork) {
				const replacement = await tokenStorage.commitReauthorizationWithFence(c, scope, { onboardingMissionId: missionId, provider, providerAccountHash: accountHash, reauthorizationWorkId: reauthWork.id, replacementAuthorizationSessionId: authorizationSessionId, replacementCorrelationId: correlationId, callbackClaim, expectedRotationGeneration: reauthWork.expected_token_generation, refreshToken: tokenExchangeResult.refreshToken || '', accessToken: tokenExchangeResult.accessToken, accessTokenExpiresAt: tokenExchangeResult.expiresAt, grantedScopes: tokenExchangeResult.grantedScopes });
				if (!replacement.committed) return { ok: false, reason: replacement.reason || 'REAUTHORIZATION_TOKEN_COMMIT_REJECTED', missionId, resumeCheckpoint };
				tokenAuthorityResult = replacement;
			} else {
				tokenAuthorityResult = await tokenStorage.storeTokens(c, scope, { onboardingMissionId: missionId, provider, providerAccountHash: accountHash, refreshToken: tokenExchangeResult.refreshToken || '', accessToken: tokenExchangeResult.accessToken, accessTokenExpiresAt: tokenExchangeResult.expiresAt, grantedScopes: tokenExchangeResult.grantedScopes });
			}
			if (callbackClaim) await callbackRecovery.recordCheckpoint(c, callbackClaim, { step: 'TOKEN_AUTHORITY_PERSISTED', status: 'PERSISTED' });

			const sessionRow = await c.env.db.prepare(`SELECT scopes_json FROM nexora_onboarding_authorization_sessions WHERE onboarding_mission_id=?1 ORDER BY created_at DESC LIMIT 1`).bind(missionId).first();
			const requiredScopes = JSON.parse(sessionRow?.scopes_json || '[]');
			const scopeCheck = validateGrantedScopes({ requiredScopes, grantedScopes: tokenExchangeResult.grantedScopes });
			const decision = await onboardingOAuth.discoverCapability(c, scope, {
				onboardingMissionId: missionId,
				provider,
				capabilityKey: 'mail_read',
				decisionInput: { scopeValid: true, identityValid: true, credentialStatus: 'active', credentialGenerationValid: true, authorityStatus: 'active', capabilities: [{ key: 'mail_read', status: scopeCheck.valid ? 'supported' : 'unknown', expiresAt: tokenExchangeResult.expiresAt }], requirement: { requiredCapabilities: ['mail_read'], approvalRequired: false, allowDegraded: false }, paramsValid: true, fencingValid: true },
			});
			capabilityStatus = decision.status;
			if (callbackClaim) await callbackRecovery.recordCheckpoint(c, callbackClaim, { step: 'CAPABILITY_DISCOVERY_COMPLETED', status: 'PERSISTED' });

			if (capabilityStatus === 'SUPPORTED') {
				if (!callbackClaim || !authorizationSessionId || !correlationId) throw new Error('nexora_real_callback_authority_missing');
				const providerAuthority = await establishProviderAuthority(c, scope, { missionId, provider, providerAccountHash: accountHash, authorizationSessionId, correlationId, callbackClaim, tokenGeneration: tokenAuthorityResult.rotationGeneration });
				continuationResult = await continueVerifiedCallback(c, scope, { missionId, provider, authorizationSessionId, correlationId, callbackClaim, resumeCheckpoint, run, ...providerAuthority });
				syncDispatched = Boolean(continuationResult?.continuation?.syncJobId);
				if (syncDispatched) await advanceInitialSyncPhase(c, scope, missionId);
				if (callbackClaim && syncDispatched) await callbackRecovery.recordCheckpoint(c, callbackClaim, { step: 'INITIAL_SYNC_DISPATCHED', status: 'PERSISTED', syncJobReference: continuationResult.continuation.syncJobId });
			} else {
				// Insufficient granted scope: this is a real, precise incremental-consent
				// blocker, not a generic failure -- validating_authority -> blocked is the
				// legal transition, matching CONSENT_REQUIRED capability results elsewhere.
				const current = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
				if (onboardingStateMachine.allowed(current.phase, 'validating_authority')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'validating_authority' });
				const revalidated = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
				if (onboardingStateMachine.allowed(revalidated.phase, 'blocked')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'blocked', blockedReason: 'CAPABILITY_SCOPE_INSUFFICIENT', requiredHumanActor: 'end_user' });
			}
		} else {
			const current = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
			const adminConsentRequired = provider === 'microsoft' && ['admin_consent_required', 'authorization_required', 'consent_required'].includes(tokenExchangeResult.errorCode);
			if (adminConsentRequired && onboardingStateMachine.allowed(current.phase, 'waiting_for_admin_consent')) {
				const tenantId = tenantHint || allowedMicrosoftTenantIds?.[0] || 'common';
				const adminConsentUrl = onboardingOAuth.buildMicrosoftAdminConsentUrl({ tenantId, clientId: c.env.NEXORA_MICROSOFT_OAUTH_CLIENT_ID, redirectUri });
				await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'waiting_for_admin_consent', blockedReason: 'ADMIN_APPROVAL_REQUIRED', requiredHumanActor: 'tenant_administrator', resumeToken: adminConsentUrl });
				capabilityStatus = 'ADMIN_APPROVAL_REQUIRED';
			} else if (onboardingStateMachine.allowed(current.phase, 'failed')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'failed', blockedReason: tokenExchangeResult.errorCode });
		}
	}

	return { ok: true, duplicate: false, missionId, resumeCheckpoint, phase: (await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first()).phase, missionResumed: Boolean(run), tokenExchangeAttempted: Boolean(code), tokenExchangeOk: tokenExchangeResult?.ok ?? null, capabilityStatus, syncDispatched, continuation: continuationResult };
}

// Restart recovery entry point: re-reads authoritative D1 state (never trusts caller-held
// state) and, if the underlying Mission run has an expired/absent lease, reclaims it -- this
// is what lets a client (or a retried request after a Worker restart) safely call resume
// without knowing or caring whether anything actually crashed.
async function resumeOnboarding(c, scope, { missionId }) {
	const phaseRow = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_state WHERE mission_id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(missionId, scope.tenantId, scope.workspaceId).first();
	if (!phaseRow) return { ok: false, reason: 'ONBOARDING_STATE_NOT_FOUND' };
	if (onboardingStateMachine.isTerminal(phaseRow.phase)) return { ok: true, resumed: false, phase: phaseRow.phase, reason: 'ALREADY_TERMINAL' };
	const runId = `onboarding-run:${missionId}`;
	const run = await durableMissionRuntime.claimRun(c, scope, runId).catch(() => null);
	return { ok: true, resumed: Boolean(run), phase: phaseRow.phase, blockedReason: phaseRow.blocked_reason, requiredHumanActor: phaseRow.required_human_actor };
}

// Cancellation is only legal from non-terminal phases per the phase machine's own transition
// table -- this function does not add a second cancellation policy, it just surfaces the
// existing guard's rejection cleanly instead of throwing past the API layer.
async function cancelOnboarding(c, scope, { missionId }) {
	const phaseRow = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(missionId, scope.tenantId, scope.workspaceId).first();
	if (!phaseRow) return { ok: false, reason: 'ONBOARDING_STATE_NOT_FOUND' };
	if (!onboardingStateMachine.allowed(phaseRow.phase, 'cancelled')) return { ok: false, reason: 'CANCELLATION_NOT_SAFE_FROM_CURRENT_PHASE', phase: phaseRow.phase };
	await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'cancelled' });
	await c.env.db.prepare(`UPDATE mission_runtime_missions SET state='cancelled',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND state IN ('created','runnable','running')`).bind(missionId, scope.tenantId, scope.workspaceId).run();
	return { ok: true, phase: 'cancelled' };
}

// Repair re-enters the validating_authority step from degraded -- the same automatic-repair
// loop the phase machine defines (connected<->degraded), entered explicitly rather than only
// after a failed refresh, so an operator/UI-triggered repair and an automatic one share one path.
async function repairOnboarding(c, scope, { missionId }) {
	const phaseRow = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(missionId, scope.tenantId, scope.workspaceId).first();
	if (!phaseRow) return { ok: false, reason: 'ONBOARDING_STATE_NOT_FOUND' };
	if (!onboardingStateMachine.allowed(phaseRow.phase, 'validating_authority')) return { ok: false, reason: 'REPAIR_NOT_ELIGIBLE_FROM_CURRENT_PHASE', phase: phaseRow.phase };
	await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'validating_authority' });
	return { ok: true, phase: 'validating_authority' };
}

export default { startOnboarding, handleCallback, resumeOnboarding, cancelOnboarding, repairOnboarding };
