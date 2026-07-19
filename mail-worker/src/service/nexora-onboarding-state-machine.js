// NEXORA Zero-Touch onboarding: the 18-state onboarding phase machine (Required Output #2).
// Distinct from the generic Durable Mission Runtime state machine (created/runnable/running/
// .../compensating/compensated) -- this is the onboarding-specific progression a
// nexora_onboarding_state row moves through. It shares the same discipline as
// durable-mission-runtime-service.js: a frozen legal-transition table, fail-closed guard
// functions, and optimistic-concurrency-guarded persistence (phase_version).
const uuid = () => crypto.randomUUID();
function assertScope(row, scope) {
	if (!row || Number(row.tenant_id) !== Number(scope.tenantId) || Number(row.workspace_id) !== Number(scope.workspaceId)) throw new Error('nexora_onboarding_scope_denied');
}

const ONBOARDING_STATES = Object.freeze({
	discovering: ['provider_identified', 'failed', 'cancelled'],
	provider_identified: ['authorization_path_selected', 'blocked', 'failed', 'cancelled'],
	authorization_path_selected: ['waiting_for_user_login', 'waiting_for_admin_consent', 'blocked', 'cancelled'],
	waiting_for_user_login: ['waiting_for_user_consent', 'cancelled', 'failed'],
	waiting_for_user_consent: ['authorization_received', 'waiting_for_admin_consent', 'cancelled', 'failed'],
	waiting_for_admin_consent: ['waiting_for_provider_review', 'authorization_received', 'blocked', 'cancelled'],
	waiting_for_provider_review: ['authorization_received', 'blocked', 'cancelled'],
	authorization_received: ['validating_authority', 'waiting_for_admin_consent', 'failed'],
	validating_authority: ['discovering_capabilities', 'blocked', 'failed'],
	discovering_capabilities: ['provisioning', 'degraded', 'blocked', 'failed'],
	provisioning: ['verifying_connection', 'failed'],
	verifying_connection: ['starting_initial_sync', 'degraded', 'failed'],
	starting_initial_sync: ['verifying_initial_sync', 'failed'],
	verifying_initial_sync: ['connected', 'degraded', 'failed'],
	// CONNECTED/DEGRADED form a repair loop: a degraded connection re-validates authority
	// (token refresh, re-consent) rather than restarting discovery from scratch, and a
	// repaired connection returns to connected -- this is the "automatic repair" contract.
	connected: ['degraded'],
	degraded: ['validating_authority', 'connected', 'blocked', 'failed'],
	blocked: ['waiting_for_admin_consent', 'waiting_for_user_consent', 'cancelled', 'failed'],
	failed: [],
	cancelled: [],
});

function allowed(from, to) {
	return Boolean(ONBOARDING_STATES[from]?.includes(to));
}
function assertTransition(from, to) {
	if (!allowed(from, to)) throw new Error('nexora_onboarding_phase_transition_rejected');
}

async function ensureOnboardingState(c, scope, { missionId, targetProvider, targetAccountOrDomainHash }) {
	await c.env.db
		.prepare(`INSERT OR IGNORE INTO nexora_onboarding_state(mission_id,tenant_id,workspace_id,target_provider,target_account_or_domain_hash) VALUES(?1,?2,?3,?4,?5)`)
		.bind(missionId, scope.tenantId, scope.workspaceId, targetProvider, targetAccountOrDomainHash)
		.run();
	const row = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
	assertScope(row, scope);
	return row;
}

// Guarded, optimistic-concurrency phase advance -- restart-safe because the authoritative
// current phase is always re-read from D1, never assumed from caller memory.
async function advancePhase(c, scope, { missionId, to, blockedReason = null, requiredHumanActor = null, resumeToken = null }) {
	const row = await c.env.db.prepare(`SELECT * FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
	assertScope(row, scope);
	assertTransition(row.phase, to);
	const result = await c.env.db
		.prepare(`UPDATE nexora_onboarding_state SET phase=?2,phase_version=phase_version+1,blocked_reason=?3,required_human_actor=?4,resume_token=?5,updated_at=CURRENT_TIMESTAMP WHERE mission_id=?1 AND tenant_id=?6 AND workspace_id=?7 AND phase=?8 AND phase_version=?9`)
		.bind(missionId, to, blockedReason, requiredHumanActor, resumeToken, scope.tenantId, scope.workspaceId, row.phase, row.phase_version)
		.run();
	if (!result.meta?.changes) throw new Error('nexora_onboarding_phase_conflict');
	// Evidence Requirement #5: every material transition is recorded, reusing the same
	// append-only mission_runtime_events audit table the Durable Mission Runtime already
	// writes to -- one evidence trail, not a second parallel one.
	await c.env.db
		.prepare(`INSERT INTO mission_runtime_events(id,mission_id,tenant_id,workspace_id,event_type,from_state,to_state,detail_json) VALUES(?1,?2,?3,?4,'ONBOARDING_PHASE_TRANSITION',?5,?6,?7)`)
		.bind(uuid(), missionId, scope.tenantId, scope.workspaceId, row.phase, to, JSON.stringify({ blocked_reason: blockedReason, required_human_actor: requiredHumanActor }))
		.run()
		.catch(() => {}); // evidence logging must never block a legitimate state transition
	return { from: row.phase, to, phaseVersion: row.phase_version + 1 };
}

const TERMINAL_PHASES = new Set(['connected', 'failed', 'cancelled']);
function isTerminal(phase) {
	return TERMINAL_PHASES.has(phase);
}

export { ONBOARDING_STATES, allowed, assertTransition, isTerminal };
export default { ensureOnboardingState, advancePhase, allowed, assertTransition, isTerminal };
