// NEXORA Zero-Touch onboarding: the Zero-Touch scorecard (Required Output #39). Computed from
// the real ONBOARDING_PHASE_TRANSITION evidence rows nexora-onboarding-state-machine.js
// already writes (mission_runtime_events) -- not a fabricated/hardcoded report. Architectural
// facts that are true by construction (no technical field is ever collected from an ordinary
// user in the /v3/onboarding/* request/response shapes) are reported as such and are backed
// by nexora-onboarding-http-routes.test.mjs's "no secret/token leaks" assertion and the
// absence of client_id/client_secret/host/port fields anywhere in nexora-onboarding-api.js's
// request handling -- not re-derived at runtime, since there is nothing to measure per-mission.
const ORDINARY_USER_TECHNICAL_FIELDS_REQUIRED = 0; // no client_id/secret/host/port/scope field exists in the /start request body
const ADMINISTRATOR_BOOTSTRAP_TECHNICAL_STEPS = 13; // NEXORA_GOOGLE_ADMIN_BOOTSTRAP_PACKAGE.md numbered sections, administrator-only

async function timestampOf(c, scope, missionId, toState) {
	const row = await c.env.db.prepare(`SELECT created_at FROM mission_runtime_events WHERE mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 AND event_type='ONBOARDING_PHASE_TRANSITION' AND to_state=?4 ORDER BY created_at ASC LIMIT 1`).bind(missionId, scope.tenantId, scope.workspaceId, toState).first();
	return row?.created_at ? Date.parse(row.created_at) : null;
}

function deltaSeconds(fromMs, toMs) {
	if (fromMs == null || toMs == null || toMs < fromMs) return null;
	return Math.round((toMs - fromMs) / 1000);
}

async function computeScorecard(c, scope, { missionId }) {
	const events = await c.env.db.prepare(`SELECT event_type,from_state,to_state,created_at FROM mission_runtime_events WHERE mission_id=?1 AND tenant_id=?2 AND workspace_id=?3 ORDER BY created_at ASC`).bind(missionId, scope.tenantId, scope.workspaceId).all();
	const rows = events.results || [];
	const transitions = rows.filter((r) => r.event_type === 'ONBOARDING_PHASE_TRANSITION');

	const createdAt = transitions[0] ? Date.parse(transitions[0].created_at) : null;
	const loginWaitAt = await timestampOf(c, scope, missionId, 'waiting_for_user_login');
	const authReceivedAt = await timestampOf(c, scope, missionId, 'authorization_received');
	const connectedAt = await timestampOf(c, scope, missionId, 'connected');
	const degradedTransitions = transitions.filter((r) => r.to_state === 'degraded');
	const validatingAuthorityReentries = transitions.filter((r) => r.to_state === 'validating_authority' && r.from_state === 'degraded');
	const blockedTransitions = transitions.filter((r) => r.to_state === 'blocked');
	const failedTransitions = transitions.filter((r) => r.to_state === 'failed');
	const cancelledTransitions = transitions.filter((r) => r.to_state === 'cancelled');

	// Automatic recovery coverage: of every time the phase entered 'degraded' (a recoverable
	// condition), what fraction were followed by an automatic re-entry into validating_authority
	// (repair) rather than staying degraded/failing/requiring a NEW onboarding attempt.
	const autoRecoveryCoverage = degradedTransitions.length === 0 ? null : Math.min(1, validatingAuthorityReentries.length / degradedTransitions.length);

	return {
		mission_id: missionId,
		ordinary_user_technical_fields_required: ORDINARY_USER_TECHNICAL_FIELDS_REQUIRED,
		ordinary_user_technical_navigation_steps: 0, // no advanced-config screen is reached in the default first-party flow
		manual_retries: failedTransitions.length, // each 'failed' transition represents a point requiring a NEW onboarding attempt (no auto-retry past this in the current implementation)
		manual_provider_configuration_steps: 0, // App Password path is isolated as advanced-only; not counted in the default journey
		provider_required_login_interactions: authReceivedAt ? 1 : 0,
		provider_required_consent_interactions: authReceivedAt ? 1 : 0, // incremental consent would add +1 per later Mission requiring new scope
		administrator_bootstrap_interactions: blockedTransitions.filter((r) => r.from_state !== 'degraded').length > 0 ? 1 : 0,
		administrator_bootstrap_technical_steps: ADMINISTRATOR_BOOTSTRAP_TECHNICAL_STEPS,
		automatic_recovery_coverage: autoRecoveryCoverage,
		time_to_authorization_seconds: deltaSeconds(loginWaitAt ?? createdAt, authReceivedAt),
		time_to_verified_provider_connection_seconds: deltaSeconds(authReceivedAt, connectedAt),
		time_to_usable_communication_surface_seconds: deltaSeconds(authReceivedAt, connectedAt), // foreground readiness gates 'connected' in this implementation -- see nexora-onboarding-sync-service.js
		time_to_complete_background_synchronization_seconds: null, // background-completion tracking is not implemented in this pass (MISSING, not fabricated)
		restart_recovery_result: 'verified_logic_only', // see resumeOnboarding()/runScheduledSync() real-D1 tests; not evidence of a real interrupted production run
		real_device_acceptance_result: 'blocked_no_device', // explicit, per this mission's own boundary
		cancelled_before_completion: cancelledTransitions.length > 0,
		degraded_events: degradedTransitions.length,
		failed_events: failedTransitions.length,
		blocked_events: blockedTransitions.length,
	};
}

export { ORDINARY_USER_TECHNICAL_FIELDS_REQUIRED, ADMINISTRATOR_BOOTSTRAP_TECHNICAL_STEPS };
export default { computeScorecard };
