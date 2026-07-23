import { decryptSecret, encryptSecret } from '../utils/secret-crypto.js';

const RECEIPT_TTL_SECONDS = 600;
const stable = (value) => Array.isArray(value)
	? `[${value.map(stable).join(',')}]`
	: value && typeof value === 'object'
		? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
		: JSON.stringify(value);

async function hash(value) {
	const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable(value)));
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

const receiptAad = (attempt) => [
	'nexora-oauth-exchange-receipt-v1',
	attempt.id,
	attempt.authorization_session_id,
	attempt.callback_correlation_id,
	attempt.callback_claim_id,
	attempt.tenant_id,
	attempt.workspace_id,
	attempt.provider,
	attempt.connection_id || '-',
	attempt.expected_connection_generation ?? '-',
	attempt.expected_authority_generation ?? '-',
	attempt.fencing_token,
	attempt.request_digest,
	attempt.receipt_expires_at || '-',
].join(':');

async function tableAvailable(c) {
	try {
		const row = await c.env.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='nexora_oauth_exchange_attempts'`).first();
		return Boolean(row);
	} catch {
		return false;
	}
}

async function claimExchange(c, scope, { authorizationSessionId, correlationId, callbackClaim, provider, connectionId = null, connectionGeneration = null, authorityGeneration = null, requestDigest }) {
	if (!await tableAvailable(c)) {
		if (String(c.env.NEXORA_CONNECTION_RUNTIME_ENABLED || 'false').toLowerCase() === 'true') throw new Error('nexora_oauth_exchange_schema_required');
		return { enabled: false };
	}
	const runtimeEnabled = String(c.env.NEXORA_CONNECTION_RUNTIME_ENABLED || 'false').toLowerCase() === 'true';
	if (runtimeEnabled) {
		const binding = await c.env.db.prepare(
			`SELECT b.connection_id,b.connection_generation,b.authority_generation,c.state
			 FROM nexora_oauth_authorization_session_bindings b
			 JOIN nexora_oauth_live_authorization_bindings la
			   ON la.authorization_session_id=b.authorization_session_id
			 JOIN nexora_connections c ON c.id=b.connection_id
			  AND c.tenant_id=b.tenant_id AND c.workspace_id=b.workspace_id
			  AND c.connection_generation=b.connection_generation
			  AND c.authority_generation=b.authority_generation
			 WHERE b.authorization_session_id=?1 AND b.tenant_id=?2 AND b.workspace_id=?3
			   AND b.provider=?4 AND b.connection_id=?5
			   AND b.connection_generation=?6 AND b.authority_generation=?7`
		).bind(authorizationSessionId, scope.tenantId, scope.workspaceId, provider, connectionId, connectionGeneration, authorityGeneration).first();
		if (!binding || binding.state !== 'AUTHORIZATION_PENDING') throw new Error('nexora_oauth_exchange_runtime_authority_denied');
	}
	const id = `oauth-exchange:${await hash({ authorizationSessionId, correlationId })}`;
	const idempotencyKey = `oauth-exchange:${authorizationSessionId}`;
	const result = await c.env.db.prepare(
		`INSERT OR IGNORE INTO nexora_oauth_exchange_attempts(
		 id,authorization_session_id,callback_correlation_id,callback_claim_id,onboarding_mission_id,
		 tenant_id,workspace_id,provider,connection_id,expected_connection_generation,
		 expected_authority_generation,exchange_owner,lease_expires_at,fencing_token,
		 idempotency_key,request_digest,state
		)
		SELECT ?1,?2,?3,?4,cc.onboarding_mission_id,?5,?6,?7,?8,?9,?10,?11,cc.lease_expires_at,?12,?13,?14,'EXCHANGE_IN_PROGRESS'
		FROM nexora_onboarding_callback_claims cc
		JOIN nexora_onboarding_authorization_sessions s ON s.id=cc.authorization_session_id
		WHERE cc.id=?4 AND cc.correlation_id=?3 AND cc.authorization_session_id=?2
		  AND cc.tenant_id=?5 AND cc.workspace_id=?6 AND cc.provider=?7
		  AND cc.lease_owner=?11 AND cc.fencing_token=?12
		  AND cc.lease_expires_at>CURRENT_TIMESTAMP
		  AND cc.claim_status IN ('CLAIMED','PROCESSING')
		  AND cc.recovery_mode='EXECUTION'
		  AND s.status='consumed' AND julianday(s.expires_at)>julianday(cc.created_at)`
	).bind(id, authorizationSessionId, correlationId, callbackClaim.id, scope.tenantId, scope.workspaceId, provider, connectionId, connectionGeneration, authorityGeneration, callbackClaim.lease_owner, callbackClaim.fencing_token, idempotencyKey, requestDigest).run();
	const attempt = await c.env.db.prepare(`SELECT * FROM nexora_oauth_exchange_attempts WHERE authorization_session_id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(authorizationSessionId, scope.tenantId, scope.workspaceId).first();
	if (!attempt) throw new Error('nexora_oauth_exchange_claim_rejected');
	if (attempt.request_digest !== requestDigest || attempt.callback_claim_id !== callbackClaim.id || Number(attempt.fencing_token) !== Number(callbackClaim.fencing_token)) {
		throw new Error('nexora_oauth_exchange_idempotency_conflict');
	}
	// INSERT OR IGNORE has exactly one winner. Even if the existing row is still
	// EXCHANGE_IN_PROGRESS, a loser must never infer ownership from that row and perform
	// a second provider request under the winner's fence.
	if (!result.meta?.changes) return { enabled: true, claimed: false, attempt };
	return { enabled: true, claimed: true, attempt };
}

async function sealResult(c, scope, attempt, exchangeResult) {
	if (!attempt) return { enabled: false, exchangeResult };
	if (attempt.state !== 'EXCHANGE_IN_PROGRESS') throw new Error('nexora_oauth_exchange_not_sealable');
	const receipt = {
		version: 1,
		attemptId: attempt.id,
		authorizationSessionId: attempt.authorization_session_id,
		callbackCorrelationId: attempt.callback_correlation_id,
		callbackClaimId: attempt.callback_claim_id,
		fencingToken: Number(attempt.fencing_token),
		requestDigest: attempt.request_digest,
		exchangeResult,
		sealedAt: new Date().toISOString(),
	};
	const plaintext = JSON.stringify(receipt);
	const receiptDigest = await hash(receipt);
	const expiresAt = new Date(Date.now() + RECEIPT_TTL_SECONDS * 1000).toISOString();
	const sealedAttempt = { ...attempt, receipt_expires_at: expiresAt };
	const ciphertext = await encryptSecret(c, plaintext, { purpose: 'provider-token', aad: receiptAad(sealedAttempt) });
	const nextState = exchangeResult.ok ? 'EXCHANGE_SUCCEEDED_COMMIT_PENDING' : (exchangeResult.retryable ? 'EXCHANGE_FAILED_RETRYABLE' : 'EXCHANGE_FAILED_TERMINAL');
	const checkpointStatus = exchangeResult.ok ? 'PERSISTED' : 'EXTERNAL_RESULT_OBSERVED';
	const abortOnZero = () => c.env.db.prepare(`INSERT INTO nexora_onboarding_callback_checkpoints(id,correlation_id,claim_id,fencing_token,step,status) SELECT NULL,NULL,NULL,NULL,NULL,NULL WHERE changes()=0`);
	await c.env.db.batch([
		c.env.db.prepare(
			`UPDATE nexora_oauth_exchange_attempts
			 SET state=?2,receipt_ciphertext=?3,receipt_digest=?4,receipt_expires_at=?5,
			     terminal_reason_code=?6,updated_at=CURRENT_TIMESTAMP
			 WHERE id=?1 AND tenant_id=?7 AND workspace_id=?8
			   AND exchange_owner=?9 AND fencing_token=?10
			   AND state='EXCHANGE_IN_PROGRESS' AND lease_expires_at>CURRENT_TIMESTAMP
			   AND EXISTS(
			    SELECT 1 FROM nexora_oauth_live_authorization_bindings la
			    WHERE la.authorization_session_id=nexora_oauth_exchange_attempts.authorization_session_id
			   )`
		).bind(attempt.id, nextState, ciphertext, receiptDigest, expiresAt, exchangeResult.ok ? null : String(exchangeResult.errorCode || 'PROVIDER_EXCHANGE_FAILED').slice(0, 80), scope.tenantId, scope.workspaceId, attempt.exchange_owner, attempt.fencing_token),
		abortOnZero(),
		c.env.db.prepare(
			`INSERT INTO nexora_onboarding_callback_checkpoints(
			 id,correlation_id,claim_id,fencing_token,step,status,attempt,observed_at,persisted_at,completed_at,last_error_code
			) VALUES(?1,?2,?3,?4,'TOKEN_EXCHANGE_RESPONSE_SEALED',?5,1,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?6)
			ON CONFLICT(correlation_id,step) DO NOTHING`
		).bind(crypto.randomUUID(), attempt.callback_correlation_id, attempt.callback_claim_id, attempt.fencing_token, checkpointStatus, exchangeResult.ok ? null : String(exchangeResult.errorCode || 'PROVIDER_EXCHANGE_FAILED').slice(0, 80)),
		abortOnZero(),
		c.env.db.prepare(
			`UPDATE nexora_oauth_authorization_session_bindings
			 SET callback_receipt_status='RECEIVED',exchange_status=?2,
			     recovery_status=?3,updated_at=CURRENT_TIMESTAMP
			 WHERE authorization_session_id=?1 AND tenant_id=?4 AND workspace_id=?5
			   AND EXISTS(
			    SELECT 1 FROM nexora_oauth_live_authorization_bindings la
			    WHERE la.authorization_session_id=nexora_oauth_authorization_session_bindings.authorization_session_id
			   )`
		).bind(attempt.authorization_session_id, nextState, exchangeResult.ok ? 'SEALED_RECEIPT_AVAILABLE' : 'RECOVERY_REQUIRED', scope.tenantId, scope.workspaceId),
		abortOnZero(),
	]);
	return { enabled: true, state: nextState, receiptDigest, exchangeResult: exchangeResult.ok ? await openResult(c, scope, attempt.id) : exchangeResult };
}

async function openResult(c, scope, attemptId) {
	const attempt = await c.env.db.prepare(
		`SELECT * FROM nexora_oauth_exchange_attempts
		 WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`
	).bind(attemptId, scope.tenantId, scope.workspaceId).first();
	if (!attempt?.receipt_ciphertext || !attempt.receipt_digest) throw new Error('nexora_oauth_exchange_receipt_missing');
	const expiresAt = Date.parse(attempt.receipt_expires_at);
	if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw new Error('nexora_oauth_exchange_receipt_expired');
	if (!['EXCHANGE_SUCCEEDED_COMMIT_PENDING','CREDENTIAL_STORED_CONNECTION_PENDING','CONNECTION_COMMITTED_VERIFICATION_PENDING'].includes(attempt.state)) {
		throw new Error('nexora_oauth_exchange_receipt_not_recoverable');
	}
	const receipt = JSON.parse(await decryptSecret(c, attempt.receipt_ciphertext, { purpose: 'provider-token', aad: receiptAad(attempt) }));
	if (await hash(receipt) !== attempt.receipt_digest
		|| receipt.attemptId !== attempt.id
		|| receipt.authorizationSessionId !== attempt.authorization_session_id
		|| receipt.callbackCorrelationId !== attempt.callback_correlation_id
		|| receipt.callbackClaimId !== attempt.callback_claim_id
		|| Number(receipt.fencingToken) !== Number(attempt.fencing_token)
		|| receipt.requestDigest !== attempt.request_digest) throw new Error('nexora_oauth_exchange_receipt_integrity_denied');
	return receipt.exchangeResult;
}

async function markState(c, scope, attemptId, fromStates, toState, updates = {}) {
	const allowed = new Set(['CREDENTIAL_STORED_CONNECTION_PENDING','CONNECTION_COMMITTED_VERIFICATION_PENDING','CALLBACK_VERIFIED','RECOVERY_REQUIRED','REAUTHORIZATION_REQUIRED']);
	if (!allowed.has(toState)) throw new Error('nexora_oauth_exchange_state_invalid');
	if (!updates.callbackClaim) throw new Error('nexora_oauth_exchange_claim_required');
	const transitions = Object.freeze({
		EXCHANGE_SUCCEEDED_COMMIT_PENDING: new Set(['CREDENTIAL_STORED_CONNECTION_PENDING','RECOVERY_REQUIRED','REAUTHORIZATION_REQUIRED']),
		CREDENTIAL_STORED_CONNECTION_PENDING: new Set(['CONNECTION_COMMITTED_VERIFICATION_PENDING','RECOVERY_REQUIRED','REAUTHORIZATION_REQUIRED']),
		CONNECTION_COMMITTED_VERIFICATION_PENDING: new Set(['CALLBACK_VERIFIED','RECOVERY_REQUIRED','REAUTHORIZATION_REQUIRED']),
		RECOVERY_REQUIRED: new Set(['REAUTHORIZATION_REQUIRED']),
	});
	if (!fromStates.length || fromStates.some((fromState) => !transitions[fromState]?.has(toState))) throw new Error('nexora_oauth_exchange_transition_denied');
	const placeholders = fromStates.map((_, index) => `?${index + 6}`).join(',');
	const tenantIndex = fromStates.length + 6;
	const workspaceIndex = fromStates.length + 7;
	const claimIndex = fromStates.length + 8;
	const ownerIndex = fromStates.length + 9;
	const fenceIndex = fromStates.length + 10;
	const result = await c.env.db.prepare(
		`UPDATE nexora_oauth_exchange_attempts
		 SET state=?2,credential_reference_id=COALESCE(?3,credential_reference_id),
		     provider_connection_id=COALESCE(?4,provider_connection_id),
		     provider_connection_generation=COALESCE(?5,provider_connection_generation),
		     receipt_ciphertext=CASE WHEN ?2 IN ('CALLBACK_VERIFIED','REAUTHORIZATION_REQUIRED') THEN NULL ELSE receipt_ciphertext END,
		     completed_at=CASE WHEN ?2 IN ('CALLBACK_VERIFIED','REAUTHORIZATION_REQUIRED') THEN CURRENT_TIMESTAMP ELSE completed_at END,
		     updated_at=CURRENT_TIMESTAMP
		 WHERE id=?1 AND tenant_id=?${tenantIndex} AND workspace_id=?${workspaceIndex}
		   AND state IN (${placeholders})
		   AND EXISTS(
		    SELECT 1 FROM nexora_onboarding_callback_claims cc
		    WHERE cc.id=?${claimIndex}
		      AND cc.correlation_id=nexora_oauth_exchange_attempts.callback_correlation_id
		      AND cc.authorization_session_id=nexora_oauth_exchange_attempts.authorization_session_id
		      AND cc.tenant_id=?${tenantIndex} AND cc.workspace_id=?${workspaceIndex}
		      AND cc.lease_owner=?${ownerIndex} AND cc.fencing_token=?${fenceIndex}
		      AND cc.lease_expires_at>CURRENT_TIMESTAMP
		      AND cc.claim_status IN ('CLAIMED','PROCESSING') AND cc.recovery_mode='EXECUTION'
		   )`
	).bind(attemptId, toState, updates.credentialReferenceId || null, updates.providerConnectionId || null, updates.providerConnectionGeneration ?? null, ...fromStates, scope.tenantId, scope.workspaceId, updates.callbackClaim.id, updates.callbackClaim.lease_owner, updates.callbackClaim.fencing_token).run();
	if (!result.meta?.changes) throw new Error('nexora_oauth_exchange_state_conflict');
	await c.env.db.prepare(
		`UPDATE nexora_oauth_authorization_session_bindings
		 SET exchange_status=?2,recovery_status=?3,updated_at=CURRENT_TIMESTAMP
		 WHERE authorization_session_id=(SELECT authorization_session_id FROM nexora_oauth_exchange_attempts WHERE id=?1)
		   AND tenant_id=?4 AND workspace_id=?5`
	).bind(attemptId, toState, toState === 'CALLBACK_VERIFIED' ? 'COMPLETED' : toState === 'REAUTHORIZATION_REQUIRED' ? 'REAUTHORIZATION_REQUIRED' : 'RECOVERY_IN_PROGRESS', scope.tenantId, scope.workspaceId).run();
	return c.env.db.prepare(`SELECT * FROM nexora_oauth_exchange_attempts WHERE id=?1`).bind(attemptId).first();
}

async function purgeExpired(c) {
	return c.env.db.prepare(
		`UPDATE nexora_oauth_exchange_attempts
		 SET state=CASE
		      WHEN state IN ('EXCHANGE_IN_PROGRESS','EXCHANGE_SUCCEEDED_COMMIT_PENDING','CREDENTIAL_STORED_CONNECTION_PENDING','CONNECTION_COMMITTED_VERIFICATION_PENDING','RECOVERY_REQUIRED')
		      THEN 'REAUTHORIZATION_REQUIRED' ELSE state END,
		     receipt_ciphertext=NULL,
		     terminal_reason_code=COALESCE(terminal_reason_code,
		       CASE WHEN state='EXCHANGE_IN_PROGRESS' THEN 'EXCHANGE_OUTCOME_AMBIGUOUS' ELSE 'EXCHANGE_RECEIPT_EXPIRED' END),
		     completed_at=COALESCE(completed_at,CURRENT_TIMESTAMP),updated_at=CURRENT_TIMESTAMP
		 WHERE (
		    state='EXCHANGE_IN_PROGRESS'
		    AND (julianday(lease_expires_at) IS NULL OR julianday(lease_expires_at)<=julianday('now'))
		   )
		    OR (
		     receipt_ciphertext IS NOT NULL
		     AND (julianday(receipt_expires_at) IS NULL OR julianday(receipt_expires_at)<=julianday('now'))
		    )`
	).run().catch(() => ({ meta: { changes: 0 } }));
}

export { claimExchange, sealResult, openResult, markState, tableAvailable, purgeExpired };
export default { claimExchange, sealResult, openResult, markState, tableAvailable, purgeExpired };
