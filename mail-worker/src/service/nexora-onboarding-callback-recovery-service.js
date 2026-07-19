// NEXORA clean-room durable callback ownership.  This service contains no provider protocol
// implementation: callers supply only correlation metadata and non-secret checkpoint references.
const uuid = () => crypto.randomUUID();
const TERMINAL_CHECKPOINTS = new Set(['PERSISTED', 'VERIFIED']);
const RECOVERY_MODES = Object.freeze({ SAFE_TO_RESUME: 'EXECUTION', RECONCILIATION_REQUIRED: 'RECONCILIATION', REAUTHORIZATION_REQUIRED: 'REAUTHORIZATION', TERMINAL: 'TERMINAL' });

async function classifyRecovery(c, correlationId) {
	const rows = await c.env.db.prepare(`SELECT step,status FROM nexora_onboarding_callback_checkpoints WHERE correlation_id=?1`).bind(correlationId).all();
	const state = new Map((rows.results || []).map((row) => [row.step, row.status]));
	if (state.get('CALLBACK_OUTCOME_VERIFIED') === 'VERIFIED') return 'TERMINAL';
	if (state.get('TOKEN_AUTHORITY_PERSISTED') === 'PERSISTED') return 'SAFE_TO_RESUME';
	if (state.has('TOKEN_EXCHANGE_RESPONSE_OBSERVED')) return 'RECONCILIATION_REQUIRED';
	if (state.has('TOKEN_EXCHANGE_REQUEST_STARTED')) return 'REAUTHORIZATION_REQUIRED';
	// Once the authorization session has been consumed, absence of an exchange record is
	// not evidence that the code remains usable.  Its redemption status is unknowable, so
	// recovery must create a replacement session instead of treating it as execution work.
	const session = await c.env.db.prepare(`SELECT s.status FROM nexora_onboarding_callback_correlations co JOIN nexora_onboarding_authorization_sessions s ON s.id=co.authorization_session_id WHERE co.id=?1`).bind(correlationId).first();
	if (session?.status === 'consumed') return 'REAUTHORIZATION_REQUIRED';
	return 'SAFE_TO_RESUME';
}

async function assertCurrentClaim(c, claim, { allowedModes = ['EXECUTION'] } = {}) {
	const current = await c.env.db.prepare(`SELECT cc.*,co.status correlation_status,s.status session_status FROM nexora_onboarding_callback_claims cc JOIN nexora_onboarding_callback_correlations co ON co.id=cc.correlation_id JOIN nexora_onboarding_authorization_sessions s ON s.id=cc.authorization_session_id WHERE cc.id=?1`).bind(claim.id).first();
	if (!current || current.lease_owner !== claim.lease_owner || Number(current.fencing_token) !== Number(claim.fencing_token)) return { ok: false, reason: 'STALE_CALLBACK_WORKER' };
	if (!current.lease_expires_at || Date.parse(current.lease_expires_at) <= Date.now()) return { ok: false, reason: 'CALLBACK_LEASE_EXPIRED' };
	if (!['CLAIMED', 'PROCESSING'].includes(current.claim_status)) return { ok: false, reason: `CALLBACK_CLAIM_${current.claim_status}` };
	if (!allowedModes.includes(current.recovery_mode)) return { ok: false, reason: 'CALLBACK_RECOVERY_MODE_DENIED' };
	if (!['pending', 'claimed'].includes(current.correlation_status) || !['pending', 'consumed'].includes(current.session_status)) return { ok: false, reason: 'CALLBACK_CORRELATION_NOT_EXECUTABLE' };
	return { ok: true, claim: current };
}

async function ensureClaim(c, correlation) {
	await c.env.db.prepare(`INSERT OR IGNORE INTO nexora_onboarding_callback_claims(id,correlation_id,authorization_session_id,onboarding_mission_id,tenant_id,workspace_id,provider) VALUES(?1,?2,?3,?4,?5,?6,?7)`).bind(uuid(), correlation.id, correlation.authorization_session_id, correlation.onboarding_mission_id, correlation.tenant_id, correlation.workspace_id, correlation.provider).run();
	return c.env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE correlation_id=?1`).bind(correlation.id).first();
}

// A claim may be acquired from AVAILABLE or safely taken over only after expiry.  The caller
// must inspect checkpoints before treating a takeover as executable; this function never says
// that a possibly-redeemed authorization code is safe to replay.
async function acquireClaim(c, correlation, { owner = uuid(), leaseSeconds = 120 } = {}) {
	const claim = await ensureClaim(c, correlation);
	const now = Date.now();
	const expired = claim.lease_expires_at && Date.parse(claim.lease_expires_at) <= now;
	// Classify even an AVAILABLE claim: a consumed session can exist without a prior claim
	// (for example after a crash during an older deployment) and must never become implicit
	// EXECUTION authority for its single-use code.
	const recovery = await classifyRecovery(c, correlation.id);
	const eligible = claim.claim_status === 'AVAILABLE' || (((claim.claim_status === 'CLAIMED' || claim.claim_status === 'PROCESSING' || claim.claim_status === 'RECOVERABLE') && expired) && ['SAFE_TO_RESUME', 'RECONCILIATION_REQUIRED', 'REAUTHORIZATION_REQUIRED'].includes(recovery));
	if (!eligible) return { acquired: false, reason: claim.claim_status === 'COMPLETED' ? 'COMPLETED' : 'IN_PROGRESS', claim };
	const mode = RECOVERY_MODES[recovery || 'SAFE_TO_RESUME'];
	const result = await c.env.db.prepare(`UPDATE nexora_onboarding_callback_claims SET claim_status='CLAIMED',recovery_mode=?2,lease_owner=?3,lease_acquired_at=CURRENT_TIMESTAMP,lease_expires_at=datetime('now',?4),fencing_token=fencing_token+1,attempt=attempt+1,takeover_count=takeover_count+CASE WHEN lease_expires_at IS NULL THEN 0 ELSE 1 END,last_heartbeat_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND (claim_status='AVAILABLE' OR (claim_status IN ('CLAIMED','PROCESSING','RECOVERABLE') AND lease_expires_at<CURRENT_TIMESTAMP))`).bind(claim.id, mode, owner, `+${Math.max(30, Math.min(300, leaseSeconds))} seconds`).run();
	if (!result.meta?.changes) return { acquired: false, reason: 'RACE_LOST', claim: await c.env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE id=?1`).bind(claim.id).first() };
	const acquired = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE id=?1`).bind(claim.id).first();
	return { acquired: true, claim: acquired, recovery: recovery || 'SAFE_TO_RESUME' };
}

// Reconciliation is deliberately an inspection-only operation.  In particular, this
// function has no provider adapter, no authorization-code input, and no token plaintext.
// It can only establish whether the durable local authority is sufficient to hand the
// claim back to EXECUTION.  The token row is bound through the same Mission/tenant/
// workspace/provider tuple as the callback correlation and its checkpoint must have been
// written by this exact fenced claim lineage.
async function reconcileTokenAuthority(c, claim) {
	const checked = await assertCurrentClaim(c, claim, { allowedModes: ['RECONCILIATION'] });
	if (!checked.ok) return { ok: false, outcome: 'BLOCKED', reason: checked.reason };
	const current = checked.claim;
	const persisted = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_callback_checkpoints WHERE correlation_id=?1 AND step='TOKEN_AUTHORITY_PERSISTED'`).bind(current.correlation_id).first();
	const observed = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_callback_checkpoints WHERE correlation_id=?1 AND step='TOKEN_EXCHANGE_RESPONSE_OBSERVED'`).bind(current.correlation_id).first();
	if (!observed) return { ok: false, outcome: 'INSUFFICIENT_EVIDENCE', reason: 'EXCHANGE_RESPONSE_NOT_OBSERVED' };
	const token = await c.env.db.prepare(`SELECT onboarding_mission_id,tenant_id,workspace_id,provider,provider_account_hash,rotation_generation,granted_scopes_json FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND provider=?4`).bind(current.onboarding_mission_id, current.tenant_id, current.workspace_id, current.provider).first();
	if (!token && !persisted) return { ok: false, outcome: 'AUTHORITY_NOT_FOUND', reason: 'TOKEN_AUTHORITY_NOT_FOUND' };
	if (!token || !persisted || Number(persisted.fencing_token) > Number(current.fencing_token)) return { ok: false, outcome: 'INSUFFICIENT_EVIDENCE', reason: 'TOKEN_AUTHORITY_LINEAGE_INCOMPLETE' };
	if (Number(token.tenant_id) !== Number(current.tenant_id) || Number(token.workspace_id) !== Number(current.workspace_id) || token.provider !== current.provider || token.onboarding_mission_id !== current.onboarding_mission_id) {
		return { ok: false, outcome: 'AUTHORITY_CONFLICT', reason: 'TOKEN_AUTHORITY_BINDING_CONFLICT' };
	}
	const advanced = await c.env.db.prepare(`UPDATE nexora_onboarding_callback_claims SET recovery_mode='EXECUTION',claim_status='CLAIMED',updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND lease_owner=?2 AND fencing_token=?3 AND recovery_mode='RECONCILIATION' AND lease_expires_at>CURRENT_TIMESTAMP`).bind(current.id, current.lease_owner, current.fencing_token).run();
	if (!advanced.meta?.changes) return { ok: false, outcome: 'BLOCKED', reason: 'CALLBACK_LEASE_LOST' };
	return { ok: true, outcome: 'AUTHORITY_CONFIRMED', claim: await c.env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE id=?1`).bind(current.id).first(), tokenGeneration: token.rotation_generation };
}

async function renewLease(c, claim, { leaseSeconds = 120 } = {}) {
	const checked = await assertCurrentClaim(c, claim);
	if (!checked.ok) return checked;
	const result = await c.env.db.prepare(`UPDATE nexora_onboarding_callback_claims SET lease_expires_at=datetime('now',?4),last_heartbeat_at=CURRENT_TIMESTAMP,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND lease_owner=?2 AND fencing_token=?3 AND lease_expires_at>CURRENT_TIMESTAMP AND claim_status IN ('CLAIMED','PROCESSING')`).bind(claim.id, claim.lease_owner, claim.fencing_token, `+${Math.max(30, Math.min(300, leaseSeconds))} seconds`).run();
	return result.meta?.changes ? { ok: true, claim: await c.env.db.prepare(`SELECT * FROM nexora_onboarding_callback_claims WHERE id=?1`).bind(claim.id).first() } : { ok: false, reason: 'CALLBACK_LEASE_LOST' };
}

async function recordCheckpoint(c, claim, { step, status, providerOperationReference = null, tokenGenerationReference = null, connectionReference = null, syncJobReference = null, missionCheckpointReference = null, lastErrorCode = null }) {
	const checked = await assertCurrentClaim(c, claim);
	if (!checked.ok) return { recorded: false, reason: checked.reason, checkpoint: null };
	const existing = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_callback_checkpoints WHERE correlation_id=?1 AND step=?2`).bind(claim.correlation_id, step).first();
	if (existing && TERMINAL_CHECKPOINTS.has(existing.status)) return { recorded: false, checkpoint: existing };
	const result = await c.env.db.prepare(`INSERT INTO nexora_onboarding_callback_checkpoints(id,correlation_id,claim_id,fencing_token,step,status,attempt,started_at,observed_at,persisted_at,completed_at,provider_operation_reference,token_generation_reference,connection_reference,sync_job_reference,mission_checkpoint_reference,last_error_code) VALUES(?1,?2,?3,?4,?5,?6,?7,CURRENT_TIMESTAMP,CASE WHEN ?6='EXTERNAL_RESULT_OBSERVED' THEN CURRENT_TIMESTAMP END,CASE WHEN ?6 IN ('PERSISTED','VERIFIED') THEN CURRENT_TIMESTAMP END,CASE WHEN ?6 IN ('PERSISTED','VERIFIED') THEN CURRENT_TIMESTAMP END,?8,?9,?10,?11,?12,?13) ON CONFLICT(correlation_id,step) DO UPDATE SET status=excluded.status,claim_id=excluded.claim_id,fencing_token=excluded.fencing_token,attempt=excluded.attempt,observed_at=COALESCE(excluded.observed_at,nexora_onboarding_callback_checkpoints.observed_at),persisted_at=COALESCE(excluded.persisted_at,nexora_onboarding_callback_checkpoints.persisted_at),completed_at=COALESCE(excluded.completed_at,nexora_onboarding_callback_checkpoints.completed_at),last_error_code=excluded.last_error_code,updated_at=CURRENT_TIMESTAMP WHERE nexora_onboarding_callback_checkpoints.status NOT IN ('PERSISTED','VERIFIED')`).bind(uuid(), claim.correlation_id, claim.id, claim.fencing_token, step, status, claim.attempt, providerOperationReference, tokenGenerationReference, connectionReference, syncJobReference, missionCheckpointReference, lastErrorCode).run();
	return { recorded: Boolean(result.meta?.changes), checkpoint: await c.env.db.prepare(`SELECT * FROM nexora_onboarding_callback_checkpoints WHERE correlation_id=?1 AND step=?2`).bind(claim.correlation_id, step).first() };
}

export { ensureClaim, acquireClaim, assertCurrentClaim, renewLease, classifyRecovery, reconcileTokenAuthority, recordCheckpoint };
export default { ensureClaim, acquireClaim, assertCurrentClaim, renewLease, classifyRecovery, reconcileTokenAuthority, recordCheckpoint };
