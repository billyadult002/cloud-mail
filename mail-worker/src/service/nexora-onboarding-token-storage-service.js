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
const tokenCrypto = (scope, onboardingMissionId, provider, credentialReferenceId, generation, tokenKind) => ({ purpose: 'provider-token', aad: `nexora-provider-token|${scope.tenantId}|${scope.workspaceId}|${provider}|${onboardingMissionId}|${credentialReferenceId}|${generation}|${tokenKind}` });

async function storeTokens(c, scope, { onboardingMissionId, provider, providerAccountHash, refreshToken, accessToken = null, accessTokenExpiresAt = null, grantedScopes, callbackClaim = null }) {
	const existing = await c.env.db.prepare(`SELECT id,rotation_generation,provider_account_hash,refresh_token_ciphertext FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND provider=?4`).bind(onboardingMissionId, scope.tenantId, scope.workspaceId, provider).first();
	if (existing && existing.provider_account_hash !== providerAccountHash) throw new Error('nexora_onboarding_token_identity_conflict');
	if (!existing && !refreshToken) throw new Error('nexora_onboarding_refresh_token_required');
	const insertId = existing?.id || uuid();
	const nextGeneration = existing ? Number(existing.rotation_generation) + 1 : 1;
	const effectiveRefreshToken = refreshToken || (existing ? await decryptSecret(c, existing.refresh_token_ciphertext, tokenCrypto(scope, onboardingMissionId, provider, existing.id, existing.rotation_generation, 'refresh')) : null);
	const refreshTokenCiphertext = await encryptSecret(c, effectiveRefreshToken, tokenCrypto(scope, onboardingMissionId, provider, insertId, nextGeneration, 'refresh'));
	const accessTokenCiphertext = accessToken ? await encryptSecret(c, accessToken, tokenCrypto(scope, onboardingMissionId, provider, insertId, nextGeneration, 'access')) : null;
	if (existing) {
		const claimGuard = callbackClaim ? ` AND EXISTS(SELECT 1 FROM nexora_onboarding_callback_claims WHERE id=?11 AND onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND provider=?4 AND lease_owner=?12 AND fencing_token=?13 AND lease_expires_at>CURRENT_TIMESTAMP AND claim_status IN ('CLAIMED','PROCESSING') AND recovery_mode='EXECUTION')` : '';
		const statement = c.env.db.prepare(`UPDATE nexora_onboarding_tokens SET refresh_token_ciphertext=?5,access_token_ciphertext=?6,access_token_expires_at=?7,granted_scopes_json=?8,rotation_generation=rotation_generation+1,connection_health='healthy',revoked_at=NULL,revoked_reason=NULL,refresh_failure_count=0,updated_at=CURRENT_TIMESTAMP WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND provider=?4 AND provider_account_hash=?9 AND rotation_generation=?10${claimGuard}`);
		const tokenUpdate = callbackClaim ? statement.bind(onboardingMissionId, scope.tenantId, scope.workspaceId, provider, refreshTokenCiphertext, accessTokenCiphertext, accessTokenExpiresAt, JSON.stringify(grantedScopes), providerAccountHash, existing.rotation_generation, callbackClaim.id, callbackClaim.lease_owner, callbackClaim.fencing_token) : statement.bind(onboardingMissionId, scope.tenantId, scope.workspaceId, provider, refreshTokenCiphertext, accessTokenCiphertext, accessTokenExpiresAt, JSON.stringify(grantedScopes), providerAccountHash, existing.rotation_generation);
		const abortOnZero=()=>c.env.db.prepare(`INSERT INTO nexora_onboarding_tokens(id,onboarding_mission_id,tenant_id,workspace_id,provider,provider_account_hash,refresh_token_ciphertext,granted_scopes_json) SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL,NULL WHERE changes()=0`);
		const statements=[tokenUpdate,abortOnZero(),c.env.db.prepare(`UPDATE nexora_onboarding_token_connection_bindings SET token_generation=?2 WHERE token_id=?1 AND tenant_id=?3 AND workspace_id=?4 AND provider=?5 AND token_generation=?6`).bind(existing.id, nextGeneration, scope.tenantId, scope.workspaceId, provider, existing.rotation_generation),abortOnZero()];
		if(String(c.env.NEXORA_CONNECTION_RUNTIME_ENABLED||'false').toLowerCase()==='true') statements.push(c.env.db.prepare(`UPDATE nexora_connections SET credential_generation=?2,updated_at=CURRENT_TIMESTAMP WHERE credential_reference_id=?1 AND tenant_id=?3 AND workspace_id=?4 AND provider=?5 AND credential_generation=?6`).bind(existing.id,nextGeneration,scope.tenantId,scope.workspaceId,provider,existing.rotation_generation),abortOnZero());
		try { await c.env.db.batch(statements); } catch { throw new Error('nexora_onboarding_token_rotation_fence_rejected'); }
		return { rotated: true, rotationGeneration: existing.rotation_generation + 1 };
	}
	const insert = callbackClaim
		? await c.env.db.prepare(`INSERT INTO nexora_onboarding_tokens(id,onboarding_mission_id,tenant_id,workspace_id,provider,provider_account_hash,refresh_token_ciphertext,access_token_ciphertext,access_token_expires_at,granted_scopes_json) SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10 WHERE EXISTS(SELECT 1 FROM nexora_onboarding_callback_claims WHERE id=?11 AND onboarding_mission_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND provider=?5 AND lease_owner=?12 AND fencing_token=?13 AND lease_expires_at>CURRENT_TIMESTAMP AND claim_status IN ('CLAIMED','PROCESSING') AND recovery_mode='EXECUTION')`).bind(insertId, onboardingMissionId, scope.tenantId, scope.workspaceId, provider, providerAccountHash, refreshTokenCiphertext, accessTokenCiphertext, accessTokenExpiresAt, JSON.stringify(grantedScopes), callbackClaim.id, callbackClaim.lease_owner, callbackClaim.fencing_token).run()
		: await c.env.db.prepare(`INSERT INTO nexora_onboarding_tokens(id,onboarding_mission_id,tenant_id,workspace_id,provider,provider_account_hash,refresh_token_ciphertext,access_token_ciphertext,access_token_expires_at,granted_scopes_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`).bind(insertId, onboardingMissionId, scope.tenantId, scope.workspaceId, provider, providerAccountHash, refreshTokenCiphertext, accessTokenCiphertext, accessTokenExpiresAt, JSON.stringify(grantedScopes)).run();
	if (!insert.meta?.changes) throw new Error('nexora_onboarding_token_callback_fence_rejected');
	return { rotated: false, rotationGeneration: 1 };
}

// Refresh workers must use this instead of storeTokens().  The expected generation is read
// before the provider call and makes a late worker unable to overwrite a newer rotation.
async function commitRefreshWithFence(c, scope, { onboardingMissionId, provider, expectedRotationGeneration, refreshWorkId, leaseToken, fenceGeneration, refreshToken, accessToken, accessTokenExpiresAt, grantedScopes }) {
	const workAuthority = await c.env.db.prepare(`SELECT provider FROM nexora_onboarding_refresh_work WHERE id=?1 AND onboarding_mission_id=?2 AND tenant_id=?3 AND workspace_id=?4`).bind(refreshWorkId, onboardingMissionId, scope.tenantId, scope.workspaceId).first();
	const effectiveProvider = provider || workAuthority?.provider;
	if (!effectiveProvider || (provider && provider !== workAuthority?.provider)) return { committed: false, reason: 'REFRESH_PROVIDER_AUTHORITY_MISMATCH' };
	const tokenAuthority = await c.env.db.prepare(`SELECT id FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND provider=?4 AND rotation_generation=?5`).bind(onboardingMissionId, scope.tenantId, scope.workspaceId, effectiveProvider, expectedRotationGeneration).first();
	if (!tokenAuthority) return { committed: false, reason: 'REFRESH_TOKEN_AUTHORITY_MISSING' };
	const committedGeneration = Number(expectedRotationGeneration) + 1;
	const refreshTokenCiphertext = await encryptSecret(c, refreshToken, tokenCrypto(scope, onboardingMissionId, effectiveProvider, tokenAuthority.id, committedGeneration, 'refresh'));
	const accessTokenCiphertext = accessToken ? await encryptSecret(c, accessToken, tokenCrypto(scope, onboardingMissionId, effectiveProvider, tokenAuthority.id, committedGeneration, 'access')) : null;
	const abortOnZero = () => c.env.db.prepare(`INSERT INTO nexora_onboarding_refresh_work(id,idempotency_key,onboarding_mission_id,tenant_id,workspace_id,provider,expected_token_generation) SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL WHERE changes()=0`);
	const statements = [
		c.env.db.prepare(`UPDATE nexora_onboarding_tokens SET refresh_token_ciphertext=?2,access_token_ciphertext=?3,access_token_expires_at=?4,granted_scopes_json=?5,rotation_generation=rotation_generation+1,connection_health='healthy',revoked_at=NULL,revoked_reason=NULL,refresh_failure_count=0,last_successful_refresh_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE onboarding_mission_id=?1 AND tenant_id=?6 AND workspace_id=?7 AND provider=?12 AND rotation_generation=?8 AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM nexora_onboarding_refresh_work WHERE id=?9 AND onboarding_mission_id=?1 AND tenant_id=?6 AND workspace_id=?7 AND provider=?12 AND status='leased' AND lease_token=?10 AND fence_generation=?11 AND lease_expires_at>CURRENT_TIMESTAMP)`).bind(onboardingMissionId, refreshTokenCiphertext, accessTokenCiphertext, accessTokenExpiresAt, JSON.stringify(grantedScopes), scope.tenantId, scope.workspaceId, expectedRotationGeneration, refreshWorkId, leaseToken, fenceGeneration, effectiveProvider),
		abortOnZero(),
		c.env.db.prepare(`UPDATE nexora_onboarding_token_connection_bindings SET token_generation=token_generation+1 WHERE tenant_id=?1 AND workspace_id=?2 AND provider=?3 AND token_generation=?4 AND EXISTS(SELECT 1 FROM nexora_onboarding_tokens t WHERE t.id=token_id AND t.onboarding_mission_id=?5 AND t.tenant_id=?1 AND t.workspace_id=?2 AND t.provider=?3 AND t.rotation_generation=?4+1)`).bind(scope.tenantId, scope.workspaceId, effectiveProvider, expectedRotationGeneration, onboardingMissionId),
		abortOnZero(),
	];
	if (String(c.env.NEXORA_CONNECTION_RUNTIME_ENABLED || 'false').toLowerCase() === 'true') statements.push(
		c.env.db.prepare(`UPDATE nexora_connections SET credential_generation=credential_generation+1,updated_at=CURRENT_TIMESTAMP WHERE tenant_id=?1 AND workspace_id=?2 AND provider=?3 AND onboarding_mission_id=?4 AND credential_generation=?5 AND credential_reference_id IN (SELECT id FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?4 AND tenant_id=?1 AND workspace_id=?2 AND provider=?3 AND rotation_generation=?5+1)`).bind(scope.tenantId, scope.workspaceId, effectiveProvider, onboardingMissionId, expectedRotationGeneration),
		abortOnZero(),
	);
	try {
		await c.env.db.batch(statements);
		return { committed: true, committedGeneration: Number(expectedRotationGeneration) + 1 };
	} catch (error) {
		return { committed: false, reason: 'REFRESH_ATOMIC_AUTHORITY_COMMIT_REJECTED', detail: String(error?.message || error).slice(0,160) };
	}
}

async function sha256Hex(value) {
	const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

// Stable operation key: identifies the logical operation (which lease/fence/generation/work
// item this is) WITHOUT any mutable outcome value. Two calls with the same operation key are
// the SAME logical operation regardless of what outcome each one carries -- this is what makes
// a conflicting-outcome retry detectable at all, instead of silently becoming two unrelated
// operations (the defect this replaces).
const failureOperationKey = ({ refreshWorkId, expectedRotationGeneration, fenceGeneration, leaseToken }) => `refresh:${refreshWorkId}:failure:${expectedRotationGeneration}:${fenceGeneration}:${leaseToken}`;
const revocationOperationKey = ({ refreshWorkId, expectedRotationGeneration, fenceGeneration, leaseToken }) => `refresh:${refreshWorkId}:revocation:${expectedRotationGeneration}:${fenceGeneration}:${leaseToken}`;

// Resolves an operation against its prior immutable result, if any. Returns:
//  - { status: 'none' } if this operation key has never been committed
//  - { status: 'identical', prior } if operation key + authority digest + outcome digest all match
//  - { status: 'outcome_conflict', prior } if operation key + authority digest match but outcome differs
//  - { status: 'authority_conflict', prior } if the operation key matches but authority digest differs
async function resolvePriorOutcome(c, operationKey, authorityDigest, outcomeDigest) {
	const prior = await c.env.db.prepare(`SELECT id,authority_tuple_digest,outcome_digest,committed_token_generation FROM nexora_provider_outcome_results WHERE idempotency_key=?1`).bind(operationKey).first();
	if (!prior) return { status: 'none' };
	if (prior.authority_tuple_digest !== authorityDigest) return { status: 'authority_conflict', prior };
	if (prior.outcome_digest !== outcomeDigest) return { status: 'outcome_conflict', prior };
	return { status: 'identical', prior };
}

// Optional provider-connection generation/identity check (Defect 2), mirroring the pattern
// already established in commitReauthorizationWithFence -- when the caller supplies both
// values, the atomic mutation additionally requires an EXISTS match against the current
// provider-connection row, so a stale or wrong connection generation cannot commit.
function connectionGuardSql(hasConnectionCheck) {
	return hasConnectionCheck ? ` AND EXISTS (SELECT 1 FROM nexora_onboarding_provider_connections WHERE onboarding_mission_id=? AND tenant_id=? AND workspace_id=? AND provider=? AND connection_identity=? AND generation=?)` : '';
}

// Shared fenced outcome paths for refresh workers. Temporary provider failures only update
// health metadata; confirmed revocation records the revocation reason. Neither path can alter
// token material or generation, and both require the current leased refresh work row.
//
// Defect 2 fix: `provider` is now part of the atomic conditional WHERE clause on BOTH the
// tokens UPDATE and the refresh_work EXISTS subquery -- a mismatched provider can no longer
// reach a commit; it fails at the D1 boundary, not by post-write comparison or JS precheck.
async function commitRefreshFailureWithFence(c, scope, { onboardingMissionId, provider = 'google', expectedRotationGeneration, refreshWorkId, leaseToken, leaseOwner = 'refresh-worker', fenceGeneration, health = 'degraded', providerConnectionIdentity = null, expectedProviderConnectionGeneration = null }) {
	const allowed = ['degraded', 'retry_scheduled'];
	if (!allowed.includes(health)) return { committed: false, reason: 'REFRESH_FAILURE_HEALTH_INVALID' };
	const operationKey = failureOperationKey({ refreshWorkId, expectedRotationGeneration, fenceGeneration, leaseToken });
	const authorityDigest = await sha256Hex({ outcome: 'FAILURE', onboardingMissionId, tenant: scope.tenantId, workspace: scope.workspaceId, provider, refreshWorkId, leaseToken, fenceGeneration, expectedRotationGeneration, providerConnectionIdentity, expectedProviderConnectionGeneration });
	const outcomeDigest = await sha256Hex({ health });
	const resolution = await resolvePriorOutcome(c, operationKey, authorityDigest, outcomeDigest);
	if (resolution.status === 'identical') return { committed: true, idempotent: true, outcomeResultId: resolution.prior.id, committedTokenGeneration: resolution.prior.committed_token_generation };
	if (resolution.status === 'outcome_conflict') return { committed: false, reason: 'REFRESH_FAILURE_OUTCOME_CONFLICT' };
	if (resolution.status === 'authority_conflict') return { committed: false, reason: 'REFRESH_FAILURE_AUTHORITY_CONFLICT' };

	const hasConnectionCheck = Boolean(providerConnectionIdentity && expectedProviderConnectionGeneration != null);
	const connectionGuard = connectionGuardSql(hasConnectionCheck);
	const connectionBindings = hasConnectionCheck ? [onboardingMissionId, scope.tenantId, scope.workspaceId, provider, providerConnectionIdentity, expectedProviderConnectionGeneration] : [];
	const outcomeId = crypto.randomUUID();
	try {
		const results = await c.env.db.batch([
			c.env.db
				.prepare(`UPDATE nexora_onboarding_tokens SET last_failed_refresh_at=CURRENT_TIMESTAMP,refresh_failure_count=refresh_failure_count+1,connection_health=?2,updated_at=CURRENT_TIMESTAMP WHERE onboarding_mission_id=?1 AND tenant_id=?3 AND workspace_id=?4 AND provider=?9 AND rotation_generation=?5 AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM nexora_onboarding_refresh_work WHERE id=?6 AND onboarding_mission_id=?1 AND provider=?9 AND status='leased' AND lease_token=?7 AND fence_generation=?8 AND lease_expires_at>CURRENT_TIMESTAMP)${connectionGuard}`)
				.bind(onboardingMissionId, health, scope.tenantId, scope.workspaceId, expectedRotationGeneration, refreshWorkId, leaseToken, fenceGeneration, provider, ...connectionBindings),
			c.env.db
				.prepare(`INSERT INTO nexora_provider_outcome_results(id,outcome_kind,operation_id,idempotency_key,authority_tuple_digest,outcome_digest,tenant_id,workspace_id,provider,mission_id,refresh_job_id,lease_owner,fencing_token,expected_token_generation,committed_token_generation,expected_provider_connection_generation,normalized_reason_code,retry_classification) SELECT ?1,'FAILURE',?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13,?14,?15,?15 WHERE changes()>0`)
				.bind(outcomeId, refreshWorkId, operationKey, authorityDigest, outcomeDigest, scope.tenantId, scope.workspaceId, provider, onboardingMissionId, refreshWorkId, leaseOwner, fenceGeneration, expectedRotationGeneration, expectedProviderConnectionGeneration, health),
		]);
		if (!results[1]?.meta?.changes) return { committed: false, reason: 'REFRESH_FAILURE_FENCE_REJECTED', health };
		return { committed: true, outcomeResultId: outcomeId, committedTokenGeneration: expectedRotationGeneration, health };
	} catch { return { committed: false, reason: 'REFRESH_FAILURE_COMMIT_FAILED', health }; }
}

// Defect 1 fix: revocation now uses the same stable-operation-key / authority-digest /
// outcome-digest contract as failure above (rather than embedding revocationObservationReference
// in the key). The pre-existing revoked_at IS NULL terminal guard is PRESERVED as defense in
// depth -- it already independently blocked the observed "conflicting duplicate revocation"
// case; this fix adds the same explicit conflict semantics failure now has, on top of it.
// Defect 2 fix: `provider` is part of the atomic WHERE clause on both statements.
async function commitRevocationWithFence(c, scope, { onboardingMissionId, provider = 'google', expectedRotationGeneration, refreshWorkId, leaseToken, leaseOwner = 'refresh-worker', fenceGeneration, revocationReason, revocationObservationReference, providerConnectionIdentity = null, expectedProviderConnectionGeneration = null }) {
	if (!revocationObservationReference || !revocationReason) return { committed: false, reason: 'REVOCATION_OBSERVATION_REQUIRED' };
	const operationKey = revocationOperationKey({ refreshWorkId, expectedRotationGeneration, fenceGeneration, leaseToken });
	const authorityDigest = await sha256Hex({ outcome: 'REVOCATION', onboardingMissionId, tenant: scope.tenantId, workspace: scope.workspaceId, provider, refreshWorkId, leaseToken, fenceGeneration, expectedRotationGeneration, providerConnectionIdentity, expectedProviderConnectionGeneration });
	const outcomeDigest = await sha256Hex({ revocationReason, revocationObservationReference });
	const resolution = await resolvePriorOutcome(c, operationKey, authorityDigest, outcomeDigest);
	if (resolution.status === 'identical') return { committed: true, idempotent: true, outcomeResultId: resolution.prior.id, committedTokenGeneration: resolution.prior.committed_token_generation };
	if (resolution.status === 'outcome_conflict') return { committed: false, reason: 'REVOCATION_OUTCOME_CONFLICT' };
	if (resolution.status === 'authority_conflict') return { committed: false, reason: 'REVOCATION_AUTHORITY_CONFLICT' };

	const hasConnectionCheck = Boolean(providerConnectionIdentity && expectedProviderConnectionGeneration != null);
	const connectionGuard = connectionGuardSql(hasConnectionCheck);
	const connectionBindings = hasConnectionCheck ? [onboardingMissionId, scope.tenantId, scope.workspaceId, provider, providerConnectionIdentity, expectedProviderConnectionGeneration] : [];
	const outcomeId = crypto.randomUUID();
	try {
		const results = await c.env.db.batch([
			c.env.db
				.prepare(`UPDATE nexora_onboarding_tokens SET connection_health='revoked',revoked_at=CURRENT_TIMESTAMP,revoked_reason=?2,updated_at=CURRENT_TIMESTAMP WHERE onboarding_mission_id=?1 AND tenant_id=?3 AND workspace_id=?4 AND provider=?9 AND rotation_generation=?5 AND revoked_at IS NULL AND EXISTS (SELECT 1 FROM nexora_onboarding_refresh_work WHERE id=?6 AND onboarding_mission_id=?1 AND provider=?9 AND status='leased' AND lease_token=?7 AND fence_generation=?8 AND lease_expires_at>CURRENT_TIMESTAMP)${connectionGuard}`)
				.bind(onboardingMissionId, revocationReason, scope.tenantId, scope.workspaceId, expectedRotationGeneration, refreshWorkId, leaseToken, fenceGeneration, provider, ...connectionBindings),
			c.env.db
				.prepare(`INSERT INTO nexora_provider_outcome_results(id,outcome_kind,operation_id,idempotency_key,authority_tuple_digest,outcome_digest,tenant_id,workspace_id,provider,mission_id,refresh_job_id,lease_owner,fencing_token,expected_token_generation,committed_token_generation,expected_provider_connection_generation,observation_reference,normalized_reason_code,retry_classification) SELECT ?1,'REVOCATION',?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?13,?14,?15,?16,'CONFIRMED_REVOCATION' WHERE changes()>0`)
				.bind(outcomeId, refreshWorkId, operationKey, authorityDigest, outcomeDigest, scope.tenantId, scope.workspaceId, provider, onboardingMissionId, refreshWorkId, leaseOwner, fenceGeneration, expectedRotationGeneration, expectedProviderConnectionGeneration, revocationObservationReference, revocationReason),
		]);
		if (!results[1]?.meta?.changes) return { committed: false, reason: 'REVOCATION_FENCE_REJECTED' };
		return { committed: true, outcomeResultId: outcomeId, committedTokenGeneration: expectedRotationGeneration };
	} catch { return { committed: false, reason: 'REVOCATION_COMMIT_FAILED' }; }
}

// Replacement authority is committed only by the replacement callback's current EXECUTION
// claim and its one durable reauthorization work row.  This conditional update makes an old
// callback, an expired claim, or a superseded token generation unable to overwrite the newer
// credential.  Token plaintext is encrypted before this boundary and never enters its audit
// metadata.
async function commitReauthorizationWithFence(c, scope, { onboardingMissionId, provider, providerAccountHash, reauthorizationWorkId, replacementAuthorizationSessionId, replacementCorrelationId, callbackClaim, expectedRotationGeneration, expectedProviderConnectionGeneration = null, providerConnectionIdentity = null, refreshToken, accessToken = null, accessTokenExpiresAt = null, grantedScopes, idempotencyKey: requestedIdempotencyKey = null, expectedPriorCheckpoint = 'TOKEN_EXCHANGE_RESPONSE_OBSERVED', scopePlanReference = null, scopePlanDigest = null, failureInjection = null }) {
	const work = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_reauthorization_work WHERE id=?1 AND onboarding_mission_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND provider=?5 AND replacement_authorization_session_id=?6 AND replacement_correlation_id=?7 AND status IN ('WAITING_FOR_USER','AUTHORITY_RECEIVED')`).bind(reauthorizationWorkId, onboardingMissionId, scope.tenantId, scope.workspaceId, provider, replacementAuthorizationSessionId, replacementCorrelationId).first();
	if (!work) return { committed: false, reason: 'REAUTHORIZATION_WORK_NOT_CURRENT' };
	const requestedScopes = (() => { try { return JSON.parse(work.requested_capabilities_json || '[]'); } catch { return []; } })();
	if (scopePlanReference && scopePlanReference !== work.scope_plan_reference) return { committed: false, reason: 'REAUTHORIZATION_SCOPE_PLAN_MISMATCH' };
	if (scopePlanDigest && work.scope_plan_digest && scopePlanDigest !== work.scope_plan_digest) return { committed: false, reason: 'REAUTHORIZATION_SCOPE_PLAN_DIGEST_MISMATCH' };
	const priorCheckpoint = await c.env.db.prepare(`SELECT status FROM nexora_onboarding_callback_checkpoints WHERE correlation_id=?1 AND step=?2 AND status IN ('PERSISTED','VERIFIED')`).bind(replacementCorrelationId, expectedPriorCheckpoint).first();
	if (!priorCheckpoint) return { committed: false, reason: 'REAUTHORIZATION_PRIOR_CHECKPOINT_MISMATCH' };
	if (expectedProviderConnectionGeneration !== null) {
		if (!providerConnectionIdentity) return { committed: false, reason: 'REAUTHORIZATION_CONNECTION_IDENTITY_REQUIRED' };
		const connection = await c.env.db.prepare(`SELECT generation FROM nexora_onboarding_provider_connections WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND provider=?4 AND connection_identity=?5`).bind(onboardingMissionId, scope.tenantId, scope.workspaceId, provider, providerConnectionIdentity).first();
		if (!connection || Number(connection.generation) !== Number(expectedProviderConnectionGeneration)) return { committed: false, reason: 'REAUTHORIZATION_PROVIDER_CONNECTION_GENERATION_MISMATCH' };
	}
	const authorityTuple = JSON.stringify({ work: reauthorizationWorkId, session: replacementAuthorizationSessionId, correlation: replacementCorrelationId, claim: callbackClaim.id, fence: callbackClaim.fencing_token, mission: onboardingMissionId, tenant: scope.tenantId, workspace: scope.workspaceId, provider, expectedGeneration: expectedRotationGeneration, expectedProviderConnectionGeneration, providerConnectionIdentity, expectedPriorCheckpoint, scopePlanReference: work.scope_plan_reference || null, grantedScopes: [...(grantedScopes || [])].sort() });
	const tupleDigest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(authorityTuple)).then(bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join(''));
	const idempotencyKey = requestedIdempotencyKey || `reauth-commit:${reauthorizationWorkId}:${replacementCorrelationId}:${expectedRotationGeneration == null ? 1 : Number(expectedRotationGeneration) + 1}`;
	const prior = await c.env.db.prepare(`SELECT id,authority_tuple_hash,committed_token_generation,status FROM nexora_onboarding_reauthorization_commit_results WHERE idempotency_key=?1`).bind(idempotencyKey).first();
	if (prior) {
		if (prior.authority_tuple_hash !== tupleDigest) return { committed: false, reason: 'REAUTHORIZATION_IDEMPOTENCY_CONFLICT' };
		if (['COMMITTED', 'EVIDENCE_PENDING', 'EVIDENCE_DELIVERED'].includes(prior.status)) return { committed: true, rotationGeneration: prior.committed_token_generation, idempotencyKey, idempotent: true };
		return { committed: false, reason: 'REAUTHORIZATION_COMMIT_NOT_REUSABLE' };
	}
	if (work.status !== 'WAITING_FOR_USER') return { committed: false, reason: 'REAUTHORIZATION_WORK_NOT_CURRENT' };
	const guardSql = `EXISTS (SELECT 1 FROM nexora_onboarding_callback_claims cc JOIN nexora_onboarding_callback_correlations co ON co.id=cc.correlation_id JOIN nexora_onboarding_authorization_sessions s ON s.id=cc.authorization_session_id WHERE cc.id=? AND cc.lease_owner=? AND cc.fencing_token=? AND cc.recovery_mode='EXECUTION' AND cc.claim_status IN ('CLAIMED','PROCESSING') AND cc.lease_expires_at>CURRENT_TIMESTAMP AND co.id=? AND co.status='claimed' AND s.id=? AND s.status='consumed' AND cc.onboarding_mission_id=? AND cc.tenant_id=? AND cc.workspace_id=? AND cc.provider=?)`;
	const guardBindings = [callbackClaim.id, callbackClaim.lease_owner, callbackClaim.fencing_token, replacementCorrelationId, replacementAuthorizationSessionId, onboardingMissionId, scope.tenantId, scope.workspaceId, provider];
	const committedGeneration = expectedRotationGeneration == null ? 1 : Number(expectedRotationGeneration) + 1;
	const existingToken = await c.env.db.prepare(`SELECT id FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND provider=?4`).bind(onboardingMissionId, scope.tenantId, scope.workspaceId, provider).first();
	const tokenReferenceId = existingToken?.id || uuid();
	const refreshTokenCiphertext = await encryptSecret(c, refreshToken, tokenCrypto(scope, onboardingMissionId, provider, tokenReferenceId, committedGeneration, 'refresh'));
	const accessTokenCiphertext = accessToken ? await encryptSecret(c, accessToken, tokenCrypto(scope, onboardingMissionId, provider, tokenReferenceId, committedGeneration, 'access')) : null;
	const resultId = uuid();
	const outboxId = uuid();
	// Test-only rollback hook.  It is inert unless an explicit harness value is supplied;
	// production callers never pass failureInjection.  The NOT NULL insert forces D1 to
	// abort the whole batch, exercising the same constraint-failure path as stale authority.
	const boundaryGuard = (label) => c.env.db.prepare(`INSERT INTO nexora_onboarding_evidence_outbox(id,commit_result_id,onboarding_mission_id,tenant_id,workspace_id,event_type,payload_json) SELECT NULL,NULL,NULL,NULL,NULL,NULL,NULL WHERE changes()=0 OR ?1=?2`).bind(failureInjection, label);
	let tokenStatement;
	if (expectedRotationGeneration == null) {
		tokenStatement = c.env.db.prepare(`INSERT INTO nexora_onboarding_tokens(id,onboarding_mission_id,tenant_id,workspace_id,provider,provider_account_hash,refresh_token_ciphertext,access_token_ciphertext,access_token_expires_at,granted_scopes_json) SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10 WHERE NOT EXISTS (SELECT 1 FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?2) AND ${guardSql}`).bind(tokenReferenceId, onboardingMissionId, scope.tenantId, scope.workspaceId, provider, providerAccountHash, refreshTokenCiphertext, accessTokenCiphertext, accessTokenExpiresAt, JSON.stringify(grantedScopes), ...guardBindings);
	} else {
		tokenStatement = c.env.db.prepare(`UPDATE nexora_onboarding_tokens SET refresh_token_ciphertext=?2,access_token_ciphertext=?3,access_token_expires_at=?4,granted_scopes_json=?5,provider_account_hash=?6,rotation_generation=rotation_generation+1,connection_health='healthy',revoked_at=NULL,revoked_reason=NULL,refresh_failure_count=0,updated_at=CURRENT_TIMESTAMP WHERE onboarding_mission_id=?1 AND tenant_id=?7 AND workspace_id=?8 AND provider=?9 AND rotation_generation=?10 AND ${guardSql}`).bind(onboardingMissionId, refreshTokenCiphertext, accessTokenCiphertext, accessTokenExpiresAt, JSON.stringify(grantedScopes), providerAccountHash, scope.tenantId, scope.workspaceId, provider, expectedRotationGeneration, ...guardBindings);
	}
	try {
		const results = await c.env.db.batch([
			tokenStatement,
			boundaryGuard('token_insertion_or_update'),
			c.env.db.prepare(`UPDATE nexora_onboarding_reauthorization_work SET status='AUTHORITY_RECEIVED',replacement_token_generation=?2,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND status='WAITING_FOR_USER' AND replacement_authorization_session_id=?3 AND replacement_correlation_id=?4 AND EXISTS (SELECT 1 FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?5 AND tenant_id=?6 AND workspace_id=?7 AND provider=?8 AND rotation_generation=?2)`).bind(reauthorizationWorkId, committedGeneration, replacementAuthorizationSessionId, replacementCorrelationId, onboardingMissionId, scope.tenantId, scope.workspaceId, provider),
			boundaryGuard('reauthorization_work_advancement'),
			c.env.db.prepare(`INSERT INTO nexora_onboarding_callback_checkpoints(id,correlation_id,claim_id,fencing_token,step,status,attempt,persisted_at,completed_at,token_generation_reference) SELECT ?1,?2,?3,?4,'TOKEN_AUTHORITY_PERSISTED','PERSISTED',?5,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,?6 WHERE EXISTS (SELECT 1 FROM nexora_onboarding_reauthorization_work WHERE id=?7 AND status='AUTHORITY_RECEIVED' AND replacement_correlation_id=?2) ON CONFLICT(correlation_id,step) DO NOTHING`).bind(uuid(), replacementCorrelationId, callbackClaim.id, callbackClaim.fencing_token, callbackClaim.attempt, committedGeneration, reauthorizationWorkId),
			boundaryGuard('checkpoint_insertion'),
			c.env.db.prepare(`INSERT INTO nexora_onboarding_reauthorization_commit_results(id,reauthorization_work_id,idempotency_key,authority_tuple_hash,onboarding_mission_id,tenant_id,workspace_id,provider,replacement_authorization_session_id,replacement_correlation_id,expected_prior_checkpoint,expected_token_generation,committed_token_generation,callback_claim_id,fencing_token,status) SELECT ?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,'EVIDENCE_PENDING' WHERE EXISTS (SELECT 1 FROM nexora_onboarding_reauthorization_work WHERE id=?2 AND status='AUTHORITY_RECEIVED')`).bind(resultId, reauthorizationWorkId, idempotencyKey, tupleDigest, onboardingMissionId, scope.tenantId, scope.workspaceId, provider, replacementAuthorizationSessionId, replacementCorrelationId, expectedPriorCheckpoint, expectedRotationGeneration, committedGeneration, callbackClaim.id, callbackClaim.fencing_token),
			boundaryGuard('immutable_result_insertion'),
			c.env.db.prepare(`INSERT INTO nexora_onboarding_evidence_outbox(id,commit_result_id,onboarding_mission_id,tenant_id,workspace_id,event_type,payload_json) SELECT ?1,?2,?3,?4,?5,'REPLACEMENT_TOKEN_AUTHORITY_COMMITTED',?6 WHERE EXISTS (SELECT 1 FROM nexora_onboarding_reauthorization_commit_results WHERE id=?2)`).bind(outboxId, resultId, onboardingMissionId, scope.tenantId, scope.workspaceId, JSON.stringify({ reauthorization_work_id: reauthorizationWorkId, correlation_id: replacementCorrelationId, token_generation: committedGeneration }))
			,
			boundaryGuard('evidence_outbox_insertion')
		]);
		return { committed: true, rotationGeneration: committedGeneration, idempotencyKey };
	} catch (error) {
		return { committed: false, reason: 'REAUTHORIZATION_ATOMIC_COMMIT_FAILED', failureDetail: failureInjection ? String(error?.message || error) : undefined };
	}
}

// The ONLY function in this module that ever returns plaintext -- intended for the internal
// token-refresh HTTP call site only, never for an API response.
async function retrieveForRuntimeUse(c, scope, { onboardingMissionId, provider, credentialReferenceId, expectedRotationGeneration, providerConnectionId, expectedProviderConnectionGeneration, purpose }) {
	if (!['provider_health','refresh'].includes(purpose)) throw new Error('nexora_onboarding_token_purpose_denied');
	if (!provider || !credentialReferenceId || !providerConnectionId || expectedRotationGeneration == null || expectedProviderConnectionGeneration == null) throw new Error('nexora_onboarding_token_authority_incomplete');
	const row = await c.env.db.prepare(`SELECT t.* FROM nexora_onboarding_tokens t JOIN nexora_onboarding_token_connection_bindings b ON b.token_id=t.id AND b.tenant_id=t.tenant_id AND b.workspace_id=t.workspace_id AND b.provider=t.provider AND b.token_generation=t.rotation_generation JOIN nexora_onboarding_provider_connections pc ON pc.id=b.connection_id AND pc.tenant_id=b.tenant_id AND pc.workspace_id=b.workspace_id AND pc.provider=b.provider AND pc.generation=b.connection_generation AND pc.connection_state='active' WHERE t.id=?1 AND t.onboarding_mission_id=?2 AND t.tenant_id=?3 AND t.workspace_id=?4 AND t.provider=?5 AND t.rotation_generation=?6 AND pc.id=?7 AND pc.generation=?8`).bind(credentialReferenceId, onboardingMissionId, scope.tenantId, scope.workspaceId, provider, expectedRotationGeneration, providerConnectionId, expectedProviderConnectionGeneration).first();
	if (!row) return null;
	assertScope(row, scope);
	if (row.revoked_at) return { revoked: true };
	const result = {
		revoked: false,
		accessTokenExpiresAt: row.access_token_expires_at,
		grantedScopes: JSON.parse(row.granted_scopes_json || '[]'),
		rotationGeneration: Number(row.rotation_generation),
		toJSON() { throw new Error('nexora_onboarding_token_result_not_serializable'); },
	};
	if (purpose === 'provider_health') result.accessToken = row.access_token_ciphertext ? await decryptSecret(c, row.access_token_ciphertext, tokenCrypto(scope, onboardingMissionId, provider, row.id, row.rotation_generation, 'access')) : null;
	if (purpose === 'refresh') result.refreshToken = await decryptSecret(c, row.refresh_token_ciphertext, tokenCrypto(scope, onboardingMissionId, provider, row.id, row.rotation_generation, 'refresh'));
	return Object.freeze(result);
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

export default { storeTokens, commitRefreshWithFence, commitRefreshFailureWithFence, commitRevocationWithFence, commitReauthorizationWithFence, retrieveForRuntimeUse, connectionHealth, markRefreshResult, markRevoked };
