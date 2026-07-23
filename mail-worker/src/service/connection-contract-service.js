const STATES = Object.freeze(['DISCOVERED','AUTHORIZATION_PENDING','CALLBACK_PENDING','CONNECTED','HEALTHY','REFRESH_PENDING','DEGRADED','RETRY_WAIT','REAUTHORIZATION_REQUIRED','SUSPENDED','REVOKED','DISCONNECTED','FAILED_TERMINAL']);
const TRANSITIONS = Object.freeze({
	DISCOVERED: ['AUTHORIZATION_PENDING','CONNECTED','REAUTHORIZATION_REQUIRED','SUSPENDED','REVOKED','FAILED_TERMINAL'],
	AUTHORIZATION_PENDING: ['CALLBACK_PENDING','CONNECTED','REAUTHORIZATION_REQUIRED','SUSPENDED','REVOKED','FAILED_TERMINAL'],
	CALLBACK_PENDING: ['CONNECTED','REAUTHORIZATION_REQUIRED','RETRY_WAIT','FAILED_TERMINAL','SUSPENDED','REVOKED'],
	CONNECTED: ['HEALTHY','DEGRADED','RETRY_WAIT','REAUTHORIZATION_REQUIRED','SUSPENDED','REVOKED','DISCONNECTED','FAILED_TERMINAL'],
	HEALTHY: ['REFRESH_PENDING','DEGRADED','RETRY_WAIT','REAUTHORIZATION_REQUIRED','SUSPENDED','REVOKED','DISCONNECTED','FAILED_TERMINAL'],
	REFRESH_PENDING: ['HEALTHY','RETRY_WAIT','REAUTHORIZATION_REQUIRED','DEGRADED','SUSPENDED','REVOKED','FAILED_TERMINAL'],
	DEGRADED: ['HEALTHY','REFRESH_PENDING','RETRY_WAIT','REAUTHORIZATION_REQUIRED','SUSPENDED','REVOKED','FAILED_TERMINAL'],
	RETRY_WAIT: ['HEALTHY','REFRESH_PENDING','DEGRADED','REAUTHORIZATION_REQUIRED','SUSPENDED','REVOKED','FAILED_TERMINAL'],
	REAUTHORIZATION_REQUIRED: ['AUTHORIZATION_PENDING','SUSPENDED','REVOKED','FAILED_TERMINAL'],
	SUSPENDED: ['DISCOVERED','REVOKED'],
	REVOKED: [], DISCONNECTED: ['DISCOVERED','AUTHORIZATION_PENDING','REVOKED'], FAILED_TERMINAL: [],
});
const OPERATIONS = Object.freeze({
	discover_connection: { timeout_ms: 1000, lease: false, evidence: true, retry: 'idempotent' },
	begin_authorization: { timeout_ms: 1000, lease: false, evidence: true, retry: 'same_idempotency_key' },
	process_callback: { timeout_ms: 5000, lease: true, evidence: true, retry: 'exact_once' },
	evaluate_connection: { timeout_ms: 3000, lease: true, evidence: true, retry: 'bounded' },
	refresh_connection: { timeout_ms: 5000, lease: true, evidence: true, retry: 'bounded_backoff' },
	acquire_provider_session: { timeout_ms: 250, lease: true, evidence: false, retry: 'none' },
	suspend_connection: { timeout_ms: 1000, lease: false, evidence: true, retry: 'idempotent' },
	revoke_connection: { timeout_ms: 1000, lease: true, evidence: true, retry: 'terminal' },
	require_reauthorization: { timeout_ms: 1000, lease: true, evidence: true, retry: 'idempotent' },
});
function transitionAllowed(from, to) { return Boolean(TRANSITIONS[from]?.includes(to)); }
function assertTransition(from, to) { if (!transitionAllowed(from, to)) throw new Error('connection_transition_rejected'); }
function positive(value, code) { const n=Number(value); if(!Number.isSafeInteger(n)||n<=0) throw new Error(code); return n; }
function nonnegative(value, code) { const n=Number(value); if(!Number.isSafeInteger(n)||n<0) throw new Error(code); return n; }
function validateScope(input) { return Object.freeze({ tenantId:positive(input.tenant_id,'connection_tenant_invalid'), workspaceId:positive(input.workspace_id,'connection_workspace_invalid'), actorUserId:positive(input.actor_user_id,'connection_actor_invalid'), accountId:positive(input.account_id,'connection_account_invalid'), authorityGeneration:nonnegative(input.authority_generation,'connection_authority_generation_invalid') }); }
export { STATES, TRANSITIONS, OPERATIONS, transitionAllowed, assertTransition, validateScope };
export default { STATES, TRANSITIONS, OPERATIONS, transitionAllowed, assertTransition, validateScope };
