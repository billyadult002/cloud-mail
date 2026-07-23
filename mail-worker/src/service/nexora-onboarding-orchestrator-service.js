// NEXORA Zero-Touch onboarding orchestrator: ties the Durable Mission Runtime (generic mission
// state), the onboarding-specific 18-state phase machine, and the OAuth/authorization-session
// contract into the single "start onboarding" / "handle callback" surface a UI or callback
// route calls. This is the automatic-Mission-continuation implementation (Required Output #20,
// ADR-8): a valid callback advances both the onboarding phase AND the underlying
// mission_runtime_missions run, with no further user action required.
import durableMissionRuntime from './durable-mission-runtime-service.js';
import onboardingStateMachine from './nexora-onboarding-state-machine.js';
import onboardingOAuth, { insertAuthorizationSession, providerEnv, validateGrantedScopes, validateIdentity, validateMicrosoftTenant } from './nexora-onboarding-oauth-service.js';
import tokenExchange, { verifyIdTokenClaims } from './nexora-onboarding-token-exchange-service.js';
import tokenStorage from './nexora-onboarding-token-storage-service.js';
import callbackRecovery from './nexora-onboarding-callback-recovery-service.js';
import { commitEvidenceDeliveryResult } from './nexora-onboarding-evidence-outbox-service.js';
import callbackContinuation from './nexora-callback-continuation-service.js';
import connectionRuntime from './connection-runtime-service.js';
import exchangeReceipt from './nexora-oauth-exchange-receipt-service.js';
import scopeManifest from './nexora-oauth-scope-manifest-service.js';
import enterpriseAuthority from './enterprise-authority-service.js';
import { decryptSecret, encryptSecret } from '../utils/secret-crypto.js';

const uuid = () => crypto.randomUUID();
async function hash(value) {
	const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

const authorizationReplayKey = (missionId) => `nexora:onboarding:authorization-replay:${missionId}`;
const authorizationReplayAad = (missionId, sessionId) => `nexora-onboarding-authorization-replay-v1:${missionId}:${sessionId}`;
const authorizationReplayEncryptionAvailable = (env) => String(env?.AI_PROVIDER_TOKEN_SECRET || env?.PROVIDER_TOKEN_SECRET || '').length >= 16;
const authorizationReplayRequestDigest = ({ provider, capabilities, tenantHint, loginHint }) => hash({
	provider,
	capabilities: [...capabilities].map(String).sort(),
	tenantHint: tenantHint || null,
	loginHint: loginHint ? String(loginHint).trim().toLowerCase() : null,
});

async function assertLiveOAuthRuntimeAuthority(c, scope, authorizationSessionId, { advancedAttempt = null } = {}) {
	if (String(c.env.NEXORA_CONNECTION_RUNTIME_ENABLED || 'false').toLowerCase() !== 'true') return null;
	const binding = await c.env.db.prepare(
		`SELECT b.*,c.state AS connection_state,c.connection_generation AS live_connection_generation,
		        c.authority_generation AS live_authority_generation,c.account_id AS live_account_id,
		        c.domain_authority_id AS live_domain_authority_id,
		        c.provider_connection_id AS live_provider_connection_id,
		        c.provider_connection_generation AS live_provider_connection_generation,
		        c.credential_reference_id AS live_credential_reference_id
		 FROM nexora_oauth_authorization_session_bindings b
		 JOIN nexora_oauth_live_authorization_bindings la
		   ON la.authorization_session_id=b.authorization_session_id
		 JOIN nexora_connections c ON c.id=b.connection_id
		  AND c.tenant_id=b.tenant_id AND c.workspace_id=b.workspace_id
		 WHERE b.authorization_session_id=?1 AND b.tenant_id=?2 AND b.workspace_id=?3`
	).bind(authorizationSessionId, scope.tenantId, scope.workspaceId).first();
	if (!binding
		|| Number(binding.live_authority_generation) !== Number(binding.authority_generation)
		|| Number(binding.live_account_id) !== Number(binding.account_id)
		|| binding.live_domain_authority_id !== binding.domain_authority_id) {
		throw new Error('nexora_oauth_live_connection_authority_denied');
	}
	const pendingExact = binding.connection_state === 'AUTHORIZATION_PENDING'
		&& Number(binding.live_connection_generation) === Number(binding.connection_generation);
	let verifiedAdvanced = false;
	if (advancedAttempt
		&& binding.connection_state === 'CONNECTED'
		&& Number(binding.live_connection_generation) === Number(binding.connection_generation) + 1
		&& binding.live_provider_connection_id === advancedAttempt.provider_connection_id
		&& Number(binding.live_provider_connection_generation) === Number(advancedAttempt.provider_connection_generation)
		&& binding.live_credential_reference_id === advancedAttempt.credential_reference_id) {
		const callbackOperation = await c.env.db.prepare(
			`SELECT id FROM nexora_connection_operations
			 WHERE connection_id=?1 AND tenant_id=?2 AND workspace_id=?3
			   AND operation_type='CALLBACK' AND callback_correlation_id=?4
			   AND state='VERIFIED'
			   AND expected_connection_generation=?5`
		).bind(binding.connection_id, scope.tenantId, scope.workspaceId, advancedAttempt.callback_correlation_id, binding.connection_generation).first();
		verifiedAdvanced = Boolean(callbackOperation);
	}
	if (!pendingExact && !verifiedAdvanced) throw new Error('nexora_oauth_live_connection_authority_denied');
	const authority = await enterpriseAuthority.resolveAccountAuthority(c, {
		workspaceId: scope.workspaceId,
		actingUserId: scope.tenantId,
		accountId: Number(binding.account_id),
		capability: 'account_state_visibility',
	});
	if (!authority.allowed || Number(authority.authorityGeneration) !== Number(binding.authority_generation)) throw new Error('nexora_oauth_live_actor_authority_denied');
	return binding;
}

async function readAuthorizationReplay(c, missionId, request) {
	if (!authorizationReplayEncryptionAvailable(c.env)) return null;
	const stored = await c.env.kv.get(authorizationReplayKey(missionId), { type: 'json' });
	if (!stored?.sessionId || !stored?.ciphertext) return null;
	const session = await c.env.db.prepare(
		`SELECT id,status,expires_at FROM nexora_onboarding_authorization_sessions
		 WHERE id=?1 AND onboarding_mission_id=?2`
	).bind(stored.sessionId, missionId).first();
	if (!session || session.status !== 'pending' || Date.parse(session.expires_at) <= Date.now()) {
		await c.env.kv.delete(authorizationReplayKey(missionId));
		return null;
	}
	const decoded = JSON.parse(await decryptSecret(c, stored.ciphertext, {
		purpose: 'provider-token',
		aad: authorizationReplayAad(missionId, session.id),
	}));
	if (decoded.sessionId !== session.id || decoded.missionId !== missionId || decoded.expiresAt !== session.expires_at) {
		throw new Error('nexora_onboarding_authorization_replay_integrity_denied');
	}
	if (decoded.requestDigest !== await authorizationReplayRequestDigest(request)) throw new Error('nexora_onboarding_idempotency_conflict');
	const { requestDigest, ...replay } = decoded;
	return { ...replay, idempotentReplay: true };
}

async function writeAuthorizationReplay(c, missionId, session, request) {
	const replay = {
		ok: true,
		missionId,
		authorizationUrl: session.authorizationUrl,
		sessionId: session.row.id,
		expiresAt: session.row.expires_at,
		state: session.state,
		nonce: session.nonce,
		verifier: session.verifier,
	};
	if (!authorizationReplayEncryptionAvailable(c.env)) return replay;
	const ciphertext = await encryptSecret(c, JSON.stringify({
		...replay,
		requestDigest: await authorizationReplayRequestDigest(request),
	}), {
		purpose: 'provider-token',
		aad: authorizationReplayAad(missionId, session.row.id),
	});
	const ttl = Math.max(60, Math.min(600, Math.ceil((Date.parse(session.row.expires_at) - Date.now()) / 1000)));
	await c.env.kv.put(authorizationReplayKey(missionId), JSON.stringify({ sessionId: session.row.id, ciphertext }), { expirationTtl: ttl });
	return replay;
}

const START_PHASE_ORDER = Object.freeze(['discovering', 'provider_identified', 'authorization_path_selected', 'waiting_for_user_login']);
async function advanceStartPhase(c, scope, missionId, target) {
	const targetIndex = START_PHASE_ORDER.indexOf(target);
	const current = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
	const currentIndex = START_PHASE_ORDER.indexOf(current?.phase);
	if (currentIndex >= targetIndex && targetIndex >= 0) return;
	if (currentIndex < 0 || targetIndex !== currentIndex + 1) throw new Error('nexora_onboarding_start_phase_conflict');
	try {
		await onboardingStateMachine.advancePhase(c, scope, { missionId, to: target });
	} catch (error) {
		if (String(error?.message) !== 'nexora_onboarding_phase_conflict') throw error;
		const raced = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
		if (START_PHASE_ORDER.indexOf(raced?.phase) < targetIndex) throw error;
	}
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
	const currentClaim=await callbackRecovery.assertCurrentClaim(c,callbackClaim);
	if(!currentClaim.ok) throw new Error(currentClaim.reason||'CALLBACK_LEASE_LOST');
	const runtimeEnabled = String(c.env.NEXORA_CONNECTION_RUNTIME_ENABLED || 'false').toLowerCase() === 'true';
	const claimGuard=`EXISTS (SELECT 1 FROM nexora_onboarding_callback_claims WHERE id=? AND onboarding_mission_id=? AND tenant_id=? AND workspace_id=? AND provider=? AND lease_owner=? AND fencing_token=? AND lease_expires_at>CURRENT_TIMESTAMP AND claim_status IN ('CLAIMED','PROCESSING') AND recovery_mode='EXECUTION')`;
	const claimBindings=[callbackClaim.id,missionId,scope.tenantId,scope.workspaceId,provider,callbackClaim.lease_owner,callbackClaim.fencing_token];
	const authorityGuard = runtimeEnabled
		? ` AND EXISTS(
		    SELECT 1
		    FROM nexora_oauth_authorization_session_bindings b
		    JOIN nexora_oauth_live_authorization_bindings la
		      ON la.authorization_session_id=b.authorization_session_id
		    JOIN nexora_connections cn
		      ON cn.id=b.connection_id
		     AND cn.tenant_id=b.tenant_id AND cn.workspace_id=b.workspace_id
		    WHERE b.authorization_session_id=?
		      AND b.onboarding_mission_id=? AND b.tenant_id=? AND b.workspace_id=? AND b.provider=?
		      AND cn.connection_generation=b.connection_generation
		      AND cn.authority_generation=b.authority_generation
		      AND cn.account_id=b.account_id AND cn.domain_authority_id=b.domain_authority_id
		      AND cn.state='AUTHORIZATION_PENDING'
		   )`
		: '';
	const authorityBindings = runtimeEnabled ? [authorizationSessionId, missionId, scope.tenantId, scope.workspaceId, provider] : [];
	const connectionId = `provider-connection:${missionId}:${provider}:${providerAccountHash}`;
	await c.env.db.prepare(`INSERT OR IGNORE INTO nexora_onboarding_provider_connections(id,onboarding_mission_id,tenant_id,workspace_id,provider,connection_identity,generation,connection_state) SELECT ?,?,?,?,?,?,1,'active' WHERE ${claimGuard}${authorityGuard}`).bind(connectionId, missionId, scope.tenantId, scope.workspaceId, provider, providerAccountHash,...claimBindings,...authorityBindings).run();
	const connection = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_provider_connections WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(connectionId, scope.tenantId, scope.workspaceId).first();
	const token = await c.env.db.prepare(`SELECT id,rotation_generation FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND provider=?4`).bind(missionId, scope.tenantId, scope.workspaceId, provider).first();
	await c.env.db.prepare(`INSERT INTO nexora_onboarding_token_connection_bindings(token_id,connection_id,tenant_id,workspace_id,provider,token_generation,connection_generation) SELECT ?,?,?,?,?,?,? WHERE ${claimGuard}${authorityGuard} ON CONFLICT(token_id) DO UPDATE SET token_generation=excluded.token_generation,connection_generation=excluded.connection_generation WHERE nexora_onboarding_token_connection_bindings.connection_id=excluded.connection_id AND nexora_onboarding_token_connection_bindings.tenant_id=excluded.tenant_id AND nexora_onboarding_token_connection_bindings.workspace_id=excluded.workspace_id AND nexora_onboarding_token_connection_bindings.provider=excluded.provider`).bind(token.id, connection.id, scope.tenantId, scope.workspaceId, provider, tokenGeneration || token.rotation_generation, connection.generation,...claimBindings,...authorityBindings).run();
	const providerOutcomeId = `provider-outcome:${correlationId}`;
	const authorityDigest = await hash({ missionId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider, authorizationSessionId, correlationId, callbackClaimId: callbackClaim.id, leaseOwner: callbackClaim.lease_owner, fencingToken: callbackClaim.fencing_token, tokenGeneration: tokenGeneration || token.rotation_generation, providerConnectionId: connection.id, providerConnectionGeneration: connection.generation });
	const outcomeDigest = await hash({ success: true, provider, providerAccountHash });
	const hasOutcomeStatus = await hasColumn(c.env.db, 'nexora_provider_outcome_results', 'outcome_status');
	const outcomeSql = hasOutcomeStatus
		? `INSERT OR IGNORE INTO nexora_provider_outcome_results(id,outcome_kind,operation_id,idempotency_key,authority_tuple_digest,outcome_digest,tenant_id,workspace_id,provider,connection_id,mission_id,authorization_session_id,correlation_id,lease_owner,fencing_token,expected_token_generation,committed_token_generation,expected_provider_connection_generation,committed_provider_connection_generation,normalized_reason_code,retry_classification,outcome_status) SELECT ?,'SUCCESS',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,'SUCCESS','TERMINAL_SUCCESS','SUCCESS' WHERE ${claimGuard}${authorityGuard}`
		: `INSERT OR IGNORE INTO nexora_provider_outcome_results(id,outcome_kind,operation_id,idempotency_key,authority_tuple_digest,outcome_digest,tenant_id,workspace_id,provider,connection_id,mission_id,authorization_session_id,correlation_id,lease_owner,fencing_token,expected_token_generation,committed_token_generation,expected_provider_connection_generation,committed_provider_connection_generation,normalized_reason_code,retry_classification) SELECT ?,'SUCCESS',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, ?,?,'SUCCESS','TERMINAL_SUCCESS' WHERE ${claimGuard}${authorityGuard}`;
	await c.env.db.prepare(outcomeSql).bind(providerOutcomeId, `callback:${correlationId}`, `callback:${correlationId}:provider-outcome`, authorityDigest, outcomeDigest, scope.tenantId, scope.workspaceId, provider, connection.id, missionId, authorizationSessionId, correlationId, callbackClaim.lease_owner, callbackClaim.fencing_token, tokenGeneration || token.rotation_generation, tokenGeneration || token.rotation_generation, connection.generation, connection.generation,...claimBindings,...authorityBindings).run();
	const revalidated=await callbackRecovery.assertCurrentClaim(c,callbackClaim);
	if(!revalidated.ok) throw new Error(revalidated.reason||'CALLBACK_LEASE_LOST');
	const outcome=await c.env.db.prepare(`SELECT authority_tuple_digest,outcome_digest FROM nexora_provider_outcome_results WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(providerOutcomeId,scope.tenantId,scope.workspaceId).first();
	if(!outcome||outcome.authority_tuple_digest!==authorityDigest||outcome.outcome_digest!==outcomeDigest) throw new Error('callback_provider_authority_commit_rejected');
	return { providerOutcomeId, tokenGeneration: tokenGeneration || token.rotation_generation, credentialReferenceId: token.id, providerConnectionId: connection.id, providerConnectionGeneration: connection.generation };
}

async function continueVerifiedCallback(c, scope, { missionId, provider, authorizationSessionId, correlationId, callbackClaim, resumeCheckpoint, run, providerOutcomeId, tokenGeneration, providerConnectionId, providerConnectionGeneration, afterCanonicalFinalization = null }) {
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
	const postFinalization = afterCanonicalFinalization ? await afterCanonicalFinalization() : null;
	await c.env.db.prepare(`UPDATE nexora_onboarding_callback_correlations SET status='VERIFIED_PENDING_CONSUMPTION' WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND status='claimed'`).bind(correlationId, scope.tenantId, scope.workspaceId).run();
	const continuationId = `mission-continuation:${missionId}`;
	const consumption = await callbackContinuation.consumeCorrelation(c, scope, { callbackCorrelationId: correlationId, idempotencyKey: `consume:${correlationId}`, missionContinuationId: continuationId, verifiedResultId: finalization.outcomeReference, finalizationId, verifierAuthorizationId: verification.verifierAuthorizationId, verificationAttemptId: verification.verificationId, missionId, provider, authorizationSessionId, expectedTokenGeneration: tokenGeneration, expectedProviderConnectionId: providerConnectionId, expectedProviderConnectionGeneration: providerConnectionGeneration, owner: callbackClaim.lease_owner, fencingToken: callbackClaim.fencing_token, expectedCorrelationState: 'VERIFIED_PENDING_CONSUMPTION', authorityTupleDigest: lineage.authorityTupleDigest, evidenceSetDigest: verification.evidenceSetDigest, expectedVerificationPolicyId: 'policy-1', expectedVerificationGeneration: 1, expectedVerificationIdempotencyKey: `verify:${callbackClaim.id}:${runId}:` });
	const continuation = await callbackContinuation.continueMission(c, scope, { continuationId, idempotencyKey: `continue:${missionId}:${correlationId}`, correlationConsumptionId: consumption.id, verifiedResultId: finalization.outcomeReference, finalizationId, verifierAuthorizationId: verification.verifierAuthorizationId, verificationAttemptId: verification.verificationId, missionId, provider, authorizationSessionId, callbackCorrelationId: correlationId, expectedTokenGeneration: tokenGeneration, expectedProviderConnectionId: providerConnectionId, expectedProviderConnectionGeneration: providerConnectionGeneration, owner: callbackClaim.lease_owner, fencingToken: callbackClaim.fencing_token, resumeCheckpoint, expectedMissionState: 'verification_pending', authorityTupleDigest: lineage.authorityTupleDigest, evidenceSetDigest: verification.evidenceSetDigest, expectedVerificationPolicyId: 'policy-1', expectedVerificationGeneration: 1, expectedVerificationIdempotencyKey: `verify:${callbackClaim.id}:${runId}:` });
	return { evidence, verification, finalization, postFinalization, consumption, continuation };
}

// Starts a new Zero-Touch onboarding Mission: creates the underlying durable mission (kind=
// 'ZERO_TOUCH_ONBOARDING'), the onboarding phase row, and an authorization session for the
// requested provider/capabilities. Idempotent per (tenant, workspace, idempotencyKey) — a
// duplicate start request (e.g. a double click) reuses the same Mission rather than creating a
// second competing onboarding flow.
async function startOnboarding(c, scope, { provider, capabilities, idempotencyKey, tenantHint = null, loginHint = null }) {
	const membership = await c.env.db.prepare(`SELECT role FROM workspace_members WHERE workspace_id=?1 AND user_id=?2`).bind(scope.workspaceId, scope.tenantId).first();
	if (!membership) return { ok: false, reason: 'WORKSPACE_AUTHORITY_REQUIRED' };
	const missionId = `onboarding:${await hash({ tenantId: scope.tenantId, workspaceId: scope.workspaceId, idempotencyKey })}`;
	await c.env.db
		.prepare(`INSERT OR IGNORE INTO mission_runtime_missions(id,tenant_id,workspace_id,user_id,kind,state,idempotency_key,claim_key) VALUES(?1,?2,?3,?2,'ZERO_TOUCH_ONBOARDING','runnable',?4,'zero_touch_onboarding_verified')`)
		.bind(missionId, scope.tenantId, scope.workspaceId, idempotencyKey)
		.run();
	const canonicalMission = await c.env.db.prepare(
		`SELECT tenant_id,workspace_id,user_id,kind,state,idempotency_key,claim_key
		 FROM mission_runtime_missions WHERE id=?1`
	).bind(missionId).first();
	if (!canonicalMission
		|| Number(canonicalMission.tenant_id) !== Number(scope.tenantId)
		|| Number(canonicalMission.workspace_id) !== Number(scope.workspaceId)
		|| Number(canonicalMission.user_id) !== Number(scope.tenantId)
		|| canonicalMission.kind !== 'ZERO_TOUCH_ONBOARDING'
		|| canonicalMission.idempotency_key !== idempotencyKey
		|| canonicalMission.claim_key !== 'zero_touch_onboarding_verified') throw new Error('nexora_onboarding_mission_conflict');
	if (canonicalMission.state !== 'runnable') throw new Error('nexora_onboarding_mission_terminal');
	const runId = `onboarding-run:${missionId}`;
	await c.env.db.prepare(
		`INSERT OR IGNORE INTO mission_runtime_runs(id,mission_id,tenant_id,workspace_id,state)
		 VALUES(?1,?2,?3,?4,'runnable')`
	).bind(runId, missionId, scope.tenantId, scope.workspaceId).run();
	const canonicalRun = await c.env.db.prepare(
		`SELECT mission_id,tenant_id,workspace_id,state FROM mission_runtime_runs WHERE id=?1`
	).bind(runId).first();
	if (!canonicalRun
		|| canonicalRun.mission_id !== missionId
		|| Number(canonicalRun.tenant_id) !== Number(scope.tenantId)
		|| Number(canonicalRun.workspace_id) !== Number(scope.workspaceId)
		|| canonicalRun.state !== 'runnable') throw new Error('nexora_onboarding_mission_run_conflict');
	await onboardingStateMachine.ensureOnboardingState(c, scope, { missionId, targetProvider: provider, targetAccountOrDomainHash: await hash(loginHint || tenantHint || provider) });
	const replayRequest = { provider, capabilities, tenantHint, loginHint };
	const replay = await readAuthorizationReplay(c, missionId, replayRequest);
	if (replay) return replay;

	await advanceStartPhase(c, scope, missionId, 'provider_identified');
	await advanceStartPhase(c, scope, missionId, 'authorization_path_selected');

	// Credential availability is checked BEFORE declaring we're waiting on the user -- a missing
	// first-party app is an administrator blocker, not something the user can act on by logging
	// in, so the phase must never claim "waiting_for_user_login" when there is nothing to log
	// into yet.
	const session = await onboardingOAuth.createAuthorizationSession(c.env, { onboardingMissionId: missionId, tenantId: scope.tenantId, workspaceId: scope.workspaceId, provider, capabilities, tenantHint, loginHint, sessionSeed: missionId });
	if (!session.ok) {
		const phaseNow = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
		if (onboardingStateMachine.allowed(phaseNow.phase, 'blocked')) {
			await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'blocked', blockedReason: session.reason, requiredHumanActor: 'workspace_administrator', resumeToken: `resume:${missionId}` });
		}
		return { ok: false, missionId, reason: session.reason, requiredEnv: session.requiredEnv };
	}
	await advanceStartPhase(c, scope, missionId, 'waiting_for_user_login');
	const insertedSession = await insertAuthorizationSession(c, session.row);
	session.row.expires_at = insertedSession.expiresAt;
	// verifier/state must reach the caller (never persisted server-side in cleartext, per
	// ADR-6) so the API layer can hand them to the client -- typically the verifier via an
	// httpOnly, short-lived cookie and state is already embedded in authorizationUrl itself.
	return writeAuthorizationReplay(c, missionId, session, replayRequest);
}

// Consumes a real provider callback and automatically resumes the originating Mission — no
// user action required beyond the provider consent screen itself. The Mission's underlying
// mission_runtime_runs lease is claimed here (real, fenced, per durable-mission-runtime-service)
// so this is restart-safe the same way every other Mission Runtime step is.
async function handleCallback(c, scope, { state, verifier, code = null, redirectUri = null, callbackFingerprint, fetchImpl, jwksFetchImpl, loginHint = null, allowedMicrosoftTenantIds = [], expectedProvider = null, failureInjection = null }) {
	if (!state || !verifier || !code || !redirectUri) return { ok: false, reason: 'CALLBACK_INPUT_INCOMPLETE' };
	const consumption = await onboardingOAuth.consumeCallback(c, scope, { state, verifier, receivedCallbackFingerprint: callbackFingerprint, expectedProvider });
	if (!consumption.ok) return { ok: false, reason: consumption.reason };
	// Scope originates only from the server-side correlation row.  The optional scope on the
	// POST test route is merely checked by consumeCallback; it can never override it.
	scope = consumption.scope;
	if (consumption.duplicate) {
		// A duplicate can observe progress or an expired claim, but can never replay the
		// single-use authorization code.  Recovery after a provider response is explicitly
		// reconciled from durable authority; absent authority proceeds to reauthorization.
		if (consumption.recovery === 'SAFE_TO_RESUME' && consumption.callbackClaim) {
			const attempt = await c.env.db.prepare(
				`SELECT id FROM nexora_oauth_exchange_attempts
				 WHERE authorization_session_id=?1 AND callback_correlation_id=?2
				   AND tenant_id=?3 AND workspace_id=?4
				   AND state IN ('EXCHANGE_SUCCEEDED_COMMIT_PENDING','CREDENTIAL_STORED_CONNECTION_PENDING','CONNECTION_COMMITTED_VERIFICATION_PENDING')`
			).bind(consumption.authorizationSessionId, consumption.correlationId, scope.tenantId, scope.workspaceId).first().catch(() => null);
			if (attempt) {
				const run = await reclaimMissionRun(c, scope, consumption.onboardingMissionId);
				return handleCallbackExchange(c, scope, {
					missionId: consumption.onboardingMissionId,
					provider: consumption.provider,
					code: null,
					verifier: null,
					redirectUri,
					fetchImpl,
					jwksFetchImpl,
					loginHint,
					tenantHint: consumption.tenantHint,
					allowedMicrosoftTenantIds,
					resumeCheckpoint: consumption.resumeCheckpoint,
					run,
					callbackClaim: consumption.callbackClaim,
					authorizationSessionId: consumption.authorizationSessionId,
					correlationId: consumption.correlationId,
					recoveredAttemptId: attempt.id,
				});
			}
		}
		// Reauthorization is a human-approved operation. A duplicate callback is never
		// permitted to manufacture a replacement authorization session.
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
	return handleCallbackExchange(c, scope, { missionId, provider, code, verifier, redirectUri, fetchImpl, jwksFetchImpl, loginHint, tenantHint, allowedMicrosoftTenantIds, resumeCheckpoint: consumption.resumeCheckpoint, run, callbackClaim: consumption.callbackClaim, authorizationSessionId: consumption.authorizationSessionId, correlationId: consumption.correlationId, failureInjection });
}

async function processConsumedCallbackIntake(c, intake, payload, { fetchImpl, jwksFetchImpl, failureInjection = null } = {}) {
	const correlation = await c.env.db.prepare(
		`SELECT * FROM nexora_onboarding_callback_correlations
		 WHERE id=?1 AND authorization_session_id=?2 AND onboarding_mission_id=?3
		   AND tenant_id=?4 AND workspace_id=?5 AND provider=?6 AND status='claimed'`
	).bind(intake.callback_correlation_id, intake.authorization_session_id, intake.onboarding_mission_id, intake.tenant_id, intake.workspace_id, intake.provider).first();
	if (!correlation) throw new Error('nexora_oauth_callback_intake_correlation_denied');
	const session = await c.env.db.prepare(
		`SELECT * FROM nexora_onboarding_authorization_sessions
		 WHERE id=?1 AND onboarding_mission_id=?2 AND tenant_id=?3 AND workspace_id=?4
		   AND provider=?5 AND status='consumed'`
	).bind(intake.authorization_session_id, intake.onboarding_mission_id, intake.tenant_id, intake.workspace_id, intake.provider).first();
	if (!session) throw new Error('nexora_oauth_callback_intake_session_denied');
	let callbackClaim = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE id=?1 AND correlation_id=?2`).bind(intake.callback_claim_id, intake.callback_correlation_id).first();
	if (!callbackClaim) throw new Error('nexora_oauth_callback_intake_claim_denied');
	if (!callbackClaim.lease_expires_at || Date.parse(callbackClaim.lease_expires_at) <= Date.now()) {
		const acquired = await callbackRecovery.acquireClaim(c, correlation, { owner: `oauth-intake:${intake.id}`, leaseSeconds: 300 });
		if (!acquired.acquired) throw new Error(acquired.reason || 'nexora_oauth_callback_intake_claim_unavailable');
		callbackClaim = acquired.claim;
	}
	const scope = { tenantId: Number(intake.tenant_id), workspaceId: Number(intake.workspace_id) };
	const existingAttempt = await c.env.db.prepare(
		`SELECT id,state FROM nexora_oauth_exchange_attempts
		 WHERE authorization_session_id=?1 AND callback_correlation_id=?2
		   AND callback_claim_id=?3 AND onboarding_mission_id=?4
		   AND tenant_id=?5 AND workspace_id=?6 AND provider=?7`
	).bind(
		intake.authorization_session_id,
		intake.callback_correlation_id,
		callbackClaim.id,
		intake.onboarding_mission_id,
		scope.tenantId,
		scope.workspaceId,
		intake.provider,
	).first().catch(() => null);
	const recoverableAttemptStates = new Set([
		'EXCHANGE_SUCCEEDED_COMMIT_PENDING',
		'CREDENTIAL_STORED_CONNECTION_PENDING',
		'CONNECTION_COMMITTED_VERIFICATION_PENDING',
	]);
	if (existingAttempt && !recoverableAttemptStates.has(existingAttempt.state)) {
		// An in-progress exchange without a sealed response is ambiguous, while terminal
		// attempts are non-reopenable. Neither state authorizes another provider request.
		throw new Error('nexora_oauth_callback_intake_exchange_not_recoverable');
	}
	const phaseRow = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(intake.onboarding_mission_id, scope.tenantId, scope.workspaceId).first();
	if (!phaseRow) throw new Error('ONBOARDING_STATE_NOT_FOUND');
	if (onboardingStateMachine.allowed(phaseRow.phase, 'waiting_for_user_consent')) await onboardingStateMachine.advancePhase(c, scope, { missionId: intake.onboarding_mission_id, to: 'waiting_for_user_consent' });
	const afterConsent = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(intake.onboarding_mission_id).first();
	if (onboardingStateMachine.allowed(afterConsent.phase, 'authorization_received')) await onboardingStateMachine.advancePhase(c, scope, { missionId: intake.onboarding_mission_id, to: 'authorization_received' });
	const run = await reclaimMissionRun(c, scope, intake.onboarding_mission_id);
	return handleCallbackExchange(c, scope, {
		missionId: intake.onboarding_mission_id,
		provider: intake.provider,
		code: existingAttempt ? null : payload.code,
		verifier: existingAttempt ? null : payload.verifier,
		redirectUri: payload.redirectUri,
		fetchImpl,
		jwksFetchImpl,
		tenantHint: session.tenant_hint,
		allowedMicrosoftTenantIds: [],
		resumeCheckpoint: session.resume_checkpoint || `resume:${intake.onboarding_mission_id}`,
		run,
		callbackClaim,
		authorizationSessionId: intake.authorization_session_id,
		correlationId: intake.callback_correlation_id,
		recoveredAttemptId: existingAttempt?.id || null,
		failureInjection,
	});
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
async function handleCallbackExchange(c, scope, { missionId, provider, code, verifier, redirectUri, fetchImpl, jwksFetchImpl, loginHint, tenantHint = null, allowedMicrosoftTenantIds, resumeCheckpoint, run, callbackClaim = null, authorizationSessionId = null, correlationId = null, recoveredAttemptId = null, failureInjection = null }) {
	let tokenExchangeResult = null;
	let exchangeAttempt = null;
	let capabilityStatus = null;
	let syncDispatched = false;
	let continuationResult = null;
	if ((code && redirectUri) || recoveredAttemptId) {
		if (callbackClaim) {
			const renewed = await callbackRecovery.renewLease(c, callbackClaim, { leaseSeconds: 300 });
			if (!renewed.ok) throw new Error('nexora_callback_lease_lost_before_exchange');
			callbackClaim = renewed.claim;
			await callbackRecovery.recordCheckpoint(c, callbackClaim, { step: 'TOKEN_EXCHANGE_INTENT_RECORDED', status: 'INTENT_RECORDED', providerOperationReference: `exchange:${callbackClaim.id}:${callbackClaim.attempt}` });
		}
		if (recoveredAttemptId) {
			exchangeAttempt = await c.env.db.prepare(`SELECT * FROM nexora_oauth_exchange_attempts WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(recoveredAttemptId, scope.tenantId, scope.workspaceId).first();
			await assertLiveOAuthRuntimeAuthority(c, scope, authorizationSessionId, {
				advancedAttempt: exchangeAttempt?.state === 'CONNECTION_COMMITTED_VERIFICATION_PENDING' ? exchangeAttempt : null,
			});
			tokenExchangeResult = await exchangeReceipt.openResult(c, scope, recoveredAttemptId);
		} else {
			const binding = await c.env.db.prepare(`SELECT * FROM nexora_oauth_authorization_session_bindings WHERE authorization_session_id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(authorizationSessionId, scope.tenantId, scope.workspaceId).first().catch(() => null);
			if (String(c.env.NEXORA_CONNECTION_RUNTIME_ENABLED || 'false').toLowerCase() === 'true' && !binding) throw new Error('nexora_oauth_authorization_session_binding_required');
			await assertLiveOAuthRuntimeAuthority(c, scope, authorizationSessionId);
			const requestDigest = await hash({
				provider,
				authorizationSessionId,
				correlationId,
				codeHash: await hash(code),
				verifierHash: await hash(verifier),
				redirectUriHash: await hash(redirectUri),
				connectionId: binding?.connection_id || null,
				connectionGeneration: binding?.connection_generation ?? null,
				authorityGeneration: binding?.authority_generation ?? null,
				scopeManifestVersion: binding?.scope_manifest_version || null,
				scopeManifestDigest: binding?.scope_manifest_digest || null,
			});
			const claimedExchange = await exchangeReceipt.claimExchange(c, scope, {
				authorizationSessionId,
				correlationId,
				callbackClaim,
				provider,
				connectionId: binding?.connection_id || null,
				connectionGeneration: binding?.connection_generation ?? null,
				authorityGeneration: binding?.authority_generation ?? null,
				requestDigest,
			});
			exchangeAttempt = claimedExchange.attempt || null;
			if (claimedExchange.enabled && !claimedExchange.claimed) throw new Error('nexora_oauth_exchange_already_attempted');
			if (callbackClaim) await callbackRecovery.recordCheckpoint(c, callbackClaim, { step: 'TOKEN_EXCHANGE_REQUEST_STARTED', status: 'IN_PROGRESS' });
			tokenExchangeResult = await tokenExchange.exchangeAuthorizationCode(c.env, { provider, code, verifier, redirectUri, tenantHint }, fetchImpl);
			const sealed = await exchangeReceipt.sealResult(c, scope, exchangeAttempt, tokenExchangeResult);
			tokenExchangeResult = sealed.exchangeResult;
			if (callbackClaim) await callbackRecovery.recordCheckpoint(c, callbackClaim, { step: 'TOKEN_EXCHANGE_RESPONSE_OBSERVED', status: sealed.enabled ? 'PERSISTED' : 'EXTERNAL_RESULT_OBSERVED', lastErrorCode: tokenExchangeResult.ok ? null : tokenExchangeResult.errorCode });
			if (failureInjection === 'after_exchange_receipt') throw new Error('test_failure_after_exchange_receipt');
		}
		if (tokenExchangeResult.ok) {
			const authorizationSession = authorizationSessionId ? await c.env.db.prepare(`SELECT nonce_hash,login_hint_hash,tenant_hint,scopes_json FROM nexora_onboarding_authorization_sessions WHERE id=?1 AND onboarding_mission_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND provider=?5`).bind(authorizationSessionId, missionId, scope.tenantId, scope.workspaceId, provider).first() : null;
			if (!authorizationSession) throw new Error('nexora_callback_authorization_session_missing');
			const manifestBinding = await c.env.db.prepare(`SELECT scope_manifest_version,scope_manifest_digest FROM nexora_oauth_authorization_session_bindings WHERE authorization_session_id=?1`).bind(authorizationSessionId).first().catch(() => null);
			if (manifestBinding) {
				const manifestCheck = await scopeManifest.verifyGrantedScopes({
					manifestVersion: manifestBinding.scope_manifest_version,
					manifestDigest: manifestBinding.scope_manifest_digest,
					provider,
					capabilities: ['mail_read'],
					requestedScopes: JSON.parse(authorizationSession.scopes_json || '[]'),
					grantedScopes: tokenExchangeResult.grantedScopes,
				});
				if (!manifestCheck.approved) {
					if (exchangeAttempt) await exchangeReceipt.markState(c, scope, exchangeAttempt.id, ['EXCHANGE_SUCCEEDED_COMMIT_PENDING'], 'REAUTHORIZATION_REQUIRED', { callbackClaim });
					const current = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
					if (onboardingStateMachine.allowed(current.phase, 'validating_authority')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'validating_authority' });
					const revalidated = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
					if (onboardingStateMachine.allowed(revalidated.phase, 'blocked')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'blocked', blockedReason: manifestCheck.reason, requiredHumanActor: 'end_user' });
					return {
						ok: false,
						reason: manifestCheck.reason,
						missionId,
						resumeCheckpoint,
						phase: (await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first()).phase,
						missionResumed: Boolean(run),
						tokenExchangeAttempted: true,
						tokenExchangeOk: true,
						capabilityStatus: 'CONSENT_REQUIRED',
						syncDispatched: false,
					};
				}
			}
			const renewed = callbackClaim ? await callbackRecovery.renewLease(c, callbackClaim, { leaseSeconds: 300 }) : { ok: false };
			if (!renewed.ok) throw new Error('nexora_callback_lease_lost_after_exchange');
			callbackClaim = renewed.claim;
			const verifiedIdToken = await verifyIdTokenClaims(c.env, { provider, idToken: tokenExchangeResult.idToken, expectedNonceHash: authorizationSession?.nonce_hash || null, tenantHint }, jwksFetchImpl || fetch);
			if (!verifiedIdToken.ok) {
				const current = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
				if (onboardingStateMachine.allowed(current.phase, 'validating_authority')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'validating_authority' });
				const revalidated = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
				if (onboardingStateMachine.allowed(revalidated.phase, 'blocked')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'blocked', blockedReason: verifiedIdToken.errorCode, requiredHumanActor: 'workspace_administrator' });
				return { ok: true, duplicate: false, missionId, resumeCheckpoint, phase: (await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first()).phase, missionResumed: Boolean(run), tokenExchangeAttempted: true, tokenExchangeOk: true, identityValid: false, capabilityStatus: null, syncDispatched: false, idTokenVerified: false, idTokenErrorCode: verifiedIdToken.errorCode };
			}
			const claims = verifiedIdToken.claims;
			const observedLoginHash = claims?.email ? await hash(String(claims.email).trim().toLowerCase()) : null;
			const identityResult = validateIdentity({ expectedLoginHint: null, providerSubject: claims?.sub, providerEmail: claims?.email });
			if (identityResult.valid && authorizationSession.login_hint_hash && observedLoginHash !== authorizationSession.login_hint_hash) Object.assign(identityResult, { valid: false, reason: 'IDENTITY_CONFLICT' });
			const tenantResult = provider === 'microsoft' ? validateMicrosoftTenant({ allowedTenantIds: authorizationSession.tenant_hint ? [authorizationSession.tenant_hint] : [], observedTenantId: claims?.tid }) : { valid: true };
			if (provider === 'microsoft' && !authorizationSession.tenant_hint) Object.assign(tenantResult, { valid: false, reason: 'TENANT_POLICY_MISSING' });

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
			if (exchangeAttempt && ['CREDENTIAL_STORED_CONNECTION_PENDING','CONNECTION_COMMITTED_VERIFICATION_PENDING'].includes(exchangeAttempt.state)) {
				const token = await c.env.db.prepare(
					`SELECT id,rotation_generation,provider_account_hash,granted_scopes_json
					 FROM nexora_onboarding_tokens
					 WHERE id=?1 AND onboarding_mission_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND provider=?5`
				).bind(exchangeAttempt.credential_reference_id, missionId, scope.tenantId, scope.workspaceId, provider).first();
				if (!token
					|| token.provider_account_hash !== accountHash
					|| JSON.stringify([...JSON.parse(token.granted_scopes_json || '[]')].sort()) !== JSON.stringify([...(tokenExchangeResult.grantedScopes || [])].sort())) {
					throw new Error('nexora_oauth_exchange_credential_recovery_conflict');
				}
				tokenAuthorityResult = { rotated: false, rotationGeneration: Number(token.rotation_generation), credentialReferenceId: token.id, exchangeStateCommitted: true, recovered: true };
			} else if (reauthWork) {
				const replacement = await tokenStorage.commitReauthorizationWithFence(c, scope, { onboardingMissionId: missionId, provider, providerAccountHash: accountHash, reauthorizationWorkId: reauthWork.id, replacementAuthorizationSessionId: authorizationSessionId, replacementCorrelationId: correlationId, callbackClaim, expectedRotationGeneration: reauthWork.expected_token_generation, refreshToken: tokenExchangeResult.refreshToken || '', accessToken: tokenExchangeResult.accessToken, accessTokenExpiresAt: tokenExchangeResult.expiresAt, grantedScopes: tokenExchangeResult.grantedScopes });
				if (!replacement.committed) return { ok: false, reason: replacement.reason || 'REAUTHORIZATION_TOKEN_COMMIT_REJECTED', missionId, resumeCheckpoint };
				tokenAuthorityResult = replacement;
			} else {
				tokenAuthorityResult = await tokenStorage.storeTokens(c, scope, { onboardingMissionId: missionId, provider, providerAccountHash: accountHash, refreshToken: tokenExchangeResult.refreshToken || null, accessToken: tokenExchangeResult.accessToken, accessTokenExpiresAt: tokenExchangeResult.expiresAt, grantedScopes: tokenExchangeResult.grantedScopes, callbackClaim, exchangeAttempt });
			}
			if (callbackClaim) await callbackRecovery.recordCheckpoint(c, callbackClaim, { step: 'TOKEN_AUTHORITY_PERSISTED', status: 'PERSISTED' });
			if (exchangeAttempt && !tokenAuthorityResult.exchangeStateCommitted) exchangeAttempt = await exchangeReceipt.markState(c, scope, exchangeAttempt.id, ['EXCHANGE_SUCCEEDED_COMMIT_PENDING'], 'CREDENTIAL_STORED_CONNECTION_PENDING', { callbackClaim, credentialReferenceId: tokenAuthorityResult.credentialReferenceId || tokenAuthorityResult.tokenReferenceId || null });
			if (exchangeAttempt && tokenAuthorityResult.exchangeStateCommitted) exchangeAttempt = await c.env.db.prepare(`SELECT * FROM nexora_oauth_exchange_attempts WHERE id=?1`).bind(exchangeAttempt.id).first();
			if (failureInjection === 'after_credential_commit') throw new Error('test_failure_after_credential_commit');

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
				const renewedBeforeAuthority = await callbackRecovery.renewLease(c, callbackClaim);
				if (!renewedBeforeAuthority.ok) throw new Error(renewedBeforeAuthority.reason || 'CALLBACK_LEASE_LOST');
				callbackClaim = renewedBeforeAuthority.claim;
				let providerAuthority;
				if (exchangeAttempt?.state === 'CONNECTION_COMMITTED_VERIFICATION_PENDING') {
					const connection = await c.env.db.prepare(
						`SELECT id,generation FROM nexora_onboarding_provider_connections
						 WHERE id=?1 AND onboarding_mission_id=?2 AND tenant_id=?3 AND workspace_id=?4
						   AND provider=?5 AND generation=?6 AND connection_state='active'`
					).bind(exchangeAttempt.provider_connection_id, missionId, scope.tenantId, scope.workspaceId, provider, exchangeAttempt.provider_connection_generation).first();
					if (!connection) throw new Error('nexora_oauth_exchange_provider_connection_recovery_conflict');
					providerAuthority = {
						providerOutcomeId: `provider-outcome:${correlationId}`,
						tokenGeneration: tokenAuthorityResult.rotationGeneration,
						credentialReferenceId: tokenAuthorityResult.credentialReferenceId,
						providerConnectionId: connection.id,
						providerConnectionGeneration: Number(connection.generation),
					};
				} else {
					providerAuthority = await establishProviderAuthority(c, scope, { missionId, provider, providerAccountHash: accountHash, authorizationSessionId, correlationId, callbackClaim, tokenGeneration: tokenAuthorityResult.rotationGeneration });
					if (exchangeAttempt) exchangeAttempt = await exchangeReceipt.markState(c, scope, exchangeAttempt.id, ['CREDENTIAL_STORED_CONNECTION_PENDING'], 'CONNECTION_COMMITTED_VERIFICATION_PENDING', { callbackClaim, credentialReferenceId: providerAuthority.credentialReferenceId, providerConnectionId: providerAuthority.providerConnectionId, providerConnectionGeneration: providerAuthority.providerConnectionGeneration });
				}
				if (failureInjection === 'after_provider_connection_commit') throw new Error('test_failure_after_provider_connection_commit');
				const renewedBeforeContinuation = await callbackRecovery.renewLease(c, callbackClaim);
				if (!renewedBeforeContinuation.ok) throw new Error(renewedBeforeContinuation.reason || 'CALLBACK_LEASE_LOST');
				callbackClaim = renewedBeforeContinuation.claim;
				const runtimeEnabled = String(c.env.NEXORA_CONNECTION_RUNTIME_ENABLED || 'false').toLowerCase() === 'true';
				continuationResult = await continueVerifiedCallback(c, scope, {
					missionId, provider, authorizationSessionId, correlationId, callbackClaim, resumeCheckpoint, run, ...providerAuthority,
					afterCanonicalFinalization: async () => {
						const binding = runtimeEnabled
							? await connectionRuntime.bindVerifiedCallback(c, scope, { authorizationSessionId, callbackCorrelationId: correlationId, onboardingMissionId: missionId, providerConnectionId: providerAuthority.providerConnectionId, providerConnectionGeneration: providerAuthority.providerConnectionGeneration, credentialReferenceId: providerAuthority.credentialReferenceId, credentialGeneration: providerAuthority.tokenGeneration })
							: { bound: false, reason: 'CONNECTION_RUNTIME_DISABLED' };
						if (runtimeEnabled && !binding.bound) throw new Error(binding.reason || 'CONNECTION_RUNTIME_CALLBACK_BINDING_REQUIRED');
						return binding;
					},
				});
				const connectionBinding = continuationResult.postFinalization;
				continuationResult = { ...continuationResult, connectionBinding };
				if (exchangeAttempt) exchangeAttempt = await exchangeReceipt.markState(c, scope, exchangeAttempt.id, ['CONNECTION_COMMITTED_VERIFICATION_PENDING'], 'CALLBACK_VERIFIED', { callbackClaim, credentialReferenceId: providerAuthority.credentialReferenceId, providerConnectionId: providerAuthority.providerConnectionId, providerConnectionGeneration: providerAuthority.providerConnectionGeneration });
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
				const adminConsentUrl = onboardingOAuth.buildMicrosoftAdminConsentUrl({ tenantId, clientId: providerEnv(c.env, 'microsoft', 'clientIdEnv'), redirectUri });
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

export { processConsumedCallbackIntake };
export default { startOnboarding, handleCallback, processConsumedCallbackIntake, resumeOnboarding, cancelOnboarding, repairOnboarding };
