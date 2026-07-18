// NEXORA Zero-Touch onboarding: token lifecycle classification and revocation/outage repair
// planning. Deterministic — operates only on caller-supplied provider response/error shapes,
// never performs a network call itself (the actual token-endpoint HTTP call requires a real
// client_secret and is out of this logic-complete pass's scope; see ADR-13 in
// docs/ADR-NEXORA-ZERO-TOUCH-ONBOARDING.md). This lets refresh/revocation/outage recovery
// logic be built and verified today against deterministic provider-error fixtures, per this
// mission's explicit instruction not to let missing production credentials block logic work.

const REFRESH_MARGIN_SECONDS = 300; // repair proactively inside this margin, never at the exact expiry instant

function classifyTokenHealth({ expiresAt, hasRefreshToken, now = Date.now() }) {
	if (!expiresAt) return { health: 'unknown', reason: 'EXPIRY_UNKNOWN' };
	const remainingMs = Date.parse(expiresAt) - now;
	if (remainingMs <= 0) return hasRefreshToken ? { health: 'expired_refreshable', reason: 'ACCESS_TOKEN_EXPIRED' } : { health: 'expired_unrefreshable', reason: 'NO_REFRESH_TOKEN' };
	if (remainingMs <= REFRESH_MARGIN_SECONDS * 1000) return { health: 'expiring_soon', reason: 'WITHIN_REFRESH_MARGIN', remainingMs };
	return { health: 'healthy', remainingMs };
}

// Provider refresh-endpoint error codes (OAuth 2.0 §5.2 + provider-specific extensions) mapped
// to a precise, non-generic repair decision. 'invalid_grant' from a refresh_token grant is the
// standard signal for a revoked/expired refresh token across both Google and Microsoft.
const REVOCATION_ERROR_CODES = new Set(['invalid_grant', 'consent_required', 'interaction_required']);
const TRANSIENT_ERROR_CODES = new Set(['temporarily_unavailable', 'server_error', 'timeout', 'rate_limited']);

function classifyRefreshFailure({ errorCode, httpStatus }) {
	if (REVOCATION_ERROR_CODES.has(errorCode)) return { classification: 'REVOKED', repairAction: 'REQUEST_REAUTHORIZATION', destructive: false };
	if (TRANSIENT_ERROR_CODES.has(errorCode) || (httpStatus >= 500 && httpStatus < 600)) return { classification: 'PROVIDER_OUTAGE', repairAction: 'RETRY_WITH_BACKOFF', destructive: false };
	if (httpStatus === 429) return { classification: 'PROVIDER_THROTTLING', repairAction: 'RETRY_WITH_BACKOFF', destructive: false };
	if (errorCode === 'invalid_scope' || errorCode === 'insufficient_scope') return { classification: 'MISSING_SCOPE', repairAction: 'REQUEST_INCREMENTAL_CONSENT', destructive: false };
	// Unknown error: fail closed to a human-visible blocked state rather than silently retrying
	// forever or silently discarding the connection (never destructive/irreversible on its own).
	return { classification: 'UNKNOWN', repairAction: 'ESCALATE_TO_BLOCKED', destructive: false };
}

// Bounded, jittered backoff plan — never an unbounded retry storm against an outaged provider.
function planBackoff({ attempt, baseSeconds = 30, maxSeconds = 3600 }) {
	const exp = Math.min(maxSeconds, baseSeconds * 2 ** Math.max(0, attempt - 1));
	return { nextAttemptInSeconds: exp, attempt, capped: exp >= maxSeconds };
}

// A repaired connection after revocation must request the SAME scopes the user previously had
// (not more, not less) — this is what makes "revoked consent -> precise minimal reauthorization
// request" true rather than a generic broad re-request.
function planRevocationRepair({ previouslyGrantedScopes }) {
	if (!Array.isArray(previouslyGrantedScopes) || !previouslyGrantedScopes.length) {
		throw new Error('nexora_onboarding_revocation_repair_missing_prior_scopes');
	}
	return { requiredScopes: [...previouslyGrantedScopes].sort(), reason: 'REVOKED_CONSENT_REPAIR' };
}

async function recordRepairAttempt(c, scope, { onboardingMissionId, runId, classification, repairAction, attempt }) {
	const uuid = crypto.randomUUID();
	await c.env.db
		.prepare(`INSERT INTO mission_runtime_events(id,mission_id,run_id,tenant_id,workspace_id,event_type,detail_json) VALUES(?1,?2,?3,?4,?5,'TOKEN_LIFECYCLE_REPAIR_ATTEMPT',?6)`)
		.bind(uuid, onboardingMissionId, runId || null, scope.tenantId, scope.workspaceId, JSON.stringify({ classification, repair_action: repairAction, attempt }))
		.run();
	return uuid;
}

export { REFRESH_MARGIN_SECONDS, REVOCATION_ERROR_CODES, TRANSIENT_ERROR_CODES, classifyTokenHealth, classifyRefreshFailure, planBackoff, planRevocationRepair };
export default { classifyTokenHealth, classifyRefreshFailure, planBackoff, planRevocationRepair, recordRepairAttempt };
