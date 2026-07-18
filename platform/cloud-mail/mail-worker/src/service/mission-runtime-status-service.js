// NEXORA Mission Runtime operational visibility (read-only). Required Output #11 /
// #9 (capability registry status) of the NEXORA existing-kernel gap-verified completion
// mission. Queries only; never writes mission_runtime_* state. Exposes exactly the fields
// the mission requires: status, current step, current checkpoint, blocked/waiting reason,
// required approval, last execution attempt, latest observation, latest verification,
// evidence references, retry eligibility, cancellation state, compensation state, final
// verdict. No secret, credential, or raw provider-token material is ever queried or
// returned here -- mission_runtime_* tables only ever store hashes and reason codes.
function assertScope(row, scope) {
	if (!row || Number(row.tenant_id) !== Number(scope.tenantId) || Number(row.workspace_id) !== Number(scope.workspaceId)) throw new Error('mission_runtime_status_scope_denied');
}

const TERMINAL_MISSION_STATES = new Set(['completed', 'failed', 'cancelled']);
const RETRYABLE_RUN_STATES = new Set(['runnable', 'retry_scheduled']);

async function missionStatus(c, scope, missionId) {
	const mission = await c.env.db.prepare(`SELECT * FROM mission_runtime_missions WHERE id=?1`).bind(missionId).first();
	assertScope(mission, scope);

	const run = await c.env.db.prepare(`SELECT * FROM mission_runtime_runs WHERE mission_id=?1 ORDER BY created_at DESC LIMIT 1`).bind(missionId).first();
	const step = run ? await c.env.db.prepare(`SELECT * FROM mission_runtime_steps WHERE run_id=?1 ORDER BY updated_at DESC LIMIT 1`).bind(run.id).first() : null;
	const checkpoint = step ? await c.env.db.prepare(`SELECT * FROM mission_runtime_checkpoints WHERE step_id=?1 ORDER BY seq DESC LIMIT 1`).bind(step.id).first() : null;

	const action = await c.env.db.prepare(`SELECT * FROM mission_runtime_actions WHERE mission_id=?1 ORDER BY updated_at DESC LIMIT 1`).bind(missionId).first();
	const approval = action ? await c.env.db.prepare(`SELECT state,expires_at,consumed_at,revoked_at FROM mission_runtime_approvals WHERE action_id=?1 ORDER BY created_at DESC LIMIT 1`).bind(action.id).first() : null;

	const evidenceRows = await c.env.db.prepare(`SELECT id,claim_key,source_type,status,observed_at,evidence_type FROM mission_runtime_evidence WHERE mission_id=?1 ORDER BY observed_at DESC LIMIT 10`).bind(missionId).all();
	const latestVerification = await c.env.db.prepare(`SELECT id,state,verifier,created_at,reason_codes_json FROM mission_runtime_verifications WHERE mission_id=?1 ORDER BY created_at DESC LIMIT 1`).bind(missionId).first();
	const outcome = await c.env.db.prepare(`SELECT id,state,claim_key,created_at FROM mission_runtime_outcomes WHERE mission_id=?1 ORDER BY created_at DESC LIMIT 1`).bind(missionId).first();
	const compensation = await c.env.db.prepare(`SELECT state,final_state,attempt,reason,completed_at FROM mission_runtime_compensations WHERE mission_id=?1 ORDER BY started_at DESC LIMIT 1`).bind(missionId).first();
	// Onboarding-specific projection (Required Output #31) -- only present for
	// kind='ZERO_TOUCH_ONBOARDING' missions; every other mission kind gets onboarding:null.
	const onboarding = mission.kind === 'ZERO_TOUCH_ONBOARDING' ? await c.env.db.prepare(`SELECT * FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first() : null;
	const authorizationSession = onboarding ? await c.env.db.prepare(`SELECT id,provider,status,expires_at,consumed_at FROM nexora_onboarding_authorization_sessions WHERE onboarding_mission_id=?1 ORDER BY created_at DESC LIMIT 1`).bind(missionId).first() : null;
	const capabilityRows = onboarding ? await c.env.db.prepare(`SELECT capability_key,status,reason_codes_json FROM nexora_onboarding_capabilities WHERE onboarding_mission_id=?1`).bind(missionId).all() : null;

	// Blocked/waiting reason: derived from the most recent DISPATCH_DENIED / approval-boundary
	// audit event for this mission, if one exists -- mission_runtime_missions itself has no
	// reason column, so this is the authoritative source the runtime already writes to.
	let blockedReason = null;
	if (mission.state === 'blocked' || mission.state === 'waiting_for_approval') {
		const event = await c.env.db
			.prepare(`SELECT event_type,detail_json,created_at FROM mission_runtime_events WHERE mission_id=?1 AND event_type IN ('DISPATCH_DENIED','OUTBOUND_ACTION_WAITING_FOR_APPROVAL','MISSION_VERIFICATION_NOT_SATISFIED') ORDER BY created_at DESC LIMIT 1`)
			.bind(missionId)
			.first();
		blockedReason = event ? { eventType: event.event_type, detail: JSON.parse(event.detail_json || '{}'), at: event.created_at } : null;
	}

	const retryEligible = Boolean(run && (RETRYABLE_RUN_STATES.has(run.state) || (run.state === 'running' && run.lease_until && Date.parse(run.lease_until) <= Date.now())));

	return {
		mission_id: mission.id,
		kind: mission.kind,
		status: mission.state,
		version: mission.version,
		created_at: mission.created_at,
		updated_at: mission.updated_at,
		completed_at: mission.completed_at,
		current_run: run ? { run_id: run.id, state: run.state, lease_until: run.lease_until, fencing_token: run.fencing_token } : null,
		current_step: step ? { step_id: step.id, step_key: step.step_key, state: step.state, checkpoint_seq: step.checkpoint_seq } : null,
		current_checkpoint: checkpoint ? { checkpoint_id: checkpoint.id, seq: checkpoint.seq, state: checkpoint.state, evidence_id: checkpoint.evidence_id, created_at: checkpoint.created_at } : null,
		blocked_reason: mission.state === 'blocked' ? blockedReason : null,
		waiting_reason: mission.state === 'waiting_for_approval' ? blockedReason : null,
		required_approval: approval ? { state: approval.state, expires_at: approval.expires_at, consumed: Boolean(approval.consumed_at), revoked: Boolean(approval.revoked_at) } : null,
		last_execution_attempt: action ? { action_id: action.id, capability: action.capability, action_type: action.action_type, state: action.state, updated_at: action.updated_at } : null,
		latest_observation: evidenceRows.results?.[0] ? { evidence_id: evidenceRows.results[0].id, source_type: evidenceRows.results[0].source_type, status: evidenceRows.results[0].status, observed_at: evidenceRows.results[0].observed_at } : null,
		latest_verification: latestVerification ? { verification_id: latestVerification.id, state: latestVerification.state, verifier: latestVerification.verifier, reason_codes: JSON.parse(latestVerification.reason_codes_json || '[]'), created_at: latestVerification.created_at } : null,
		evidence_references: (evidenceRows.results || []).map((row) => ({ evidence_id: row.id, claim_key: row.claim_key, evidence_type: row.evidence_type, status: row.status, observed_at: row.observed_at })),
		retry_eligible: retryEligible,
		cancellation_state: mission.state === 'cancelled' ? 'cancelled' : 'not_cancelled',
		compensation_state: compensation ? { state: compensation.state, final_state: compensation.final_state, attempt: compensation.attempt, reason: compensation.reason, completed_at: compensation.completed_at } : 'not_requested',
		final_verdict: TERMINAL_MISSION_STATES.has(mission.state) || mission.state === 'compensated' ? (outcome ? { state: outcome.state, claim_key: outcome.claim_key, outcome_id: outcome.id, at: outcome.created_at } : { state: mission.state, outcome: null }) : null,
		onboarding: onboarding
			? {
					phase: onboarding.phase,
					target_provider: onboarding.target_provider,
					discovery_state: onboarding.discovery_state,
					authorization_state: onboarding.authorization_state,
					approval_state: onboarding.approval_state,
					connection_state: onboarding.connection_state,
					capability_state: onboarding.capability_state,
					sync_state: onboarding.sync_state,
					verification_state: onboarding.verification_state,
					blocked_reason: onboarding.blocked_reason,
					required_human_actor: onboarding.required_human_actor,
					resume_token: onboarding.resume_token,
					authorization_session: authorizationSession ? { session_id: authorizationSession.id, provider: authorizationSession.provider, status: authorizationSession.status, expires_at: authorizationSession.expires_at, consumed: Boolean(authorizationSession.consumed_at) } : null,
					capability_discovery: (capabilityRows?.results || []).map((row) => ({ capability: row.capability_key, status: row.status, reason_codes: JSON.parse(row.reason_codes_json || '[]') })),
					provider_acceptance_blocker: onboarding.phase === 'blocked' && onboarding.blocked_reason === 'PROVIDER_APPLICATION_MISSING' ? 'PRODUCTION_OAUTH_APPLICATION_NOT_REGISTERED' : null,
				}
			: null,
	};
}

async function listMissions(c, scope, { state = null, limit = 25 } = {}) {
	const bound = Math.max(1, Math.min(100, Number(limit) || 25));
	const rows = state
		? await c.env.db.prepare(`SELECT id,kind,state,version,created_at,updated_at FROM mission_runtime_missions WHERE tenant_id=?1 AND workspace_id=?2 AND state=?3 ORDER BY updated_at DESC LIMIT ?4`).bind(scope.tenantId, scope.workspaceId, state, bound).all()
		: await c.env.db.prepare(`SELECT id,kind,state,version,created_at,updated_at FROM mission_runtime_missions WHERE tenant_id=?1 AND workspace_id=?2 ORDER BY updated_at DESC LIMIT ?3`).bind(scope.tenantId, scope.workspaceId, bound).all();
	return { missions: rows.results || [] };
}

export { assertScope };
export default { missionStatus, listMissions };
