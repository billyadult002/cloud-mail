// NEXORA Zero-Touch onboarding orchestrator: ties the Durable Mission Runtime (generic mission
// state), the onboarding-specific 18-state phase machine, and the OAuth/authorization-session
// contract into the single "start onboarding" / "handle callback" surface a UI or callback
// route calls. This is the automatic-Mission-continuation implementation (Required Output #20,
// ADR-8): a valid callback advances both the onboarding phase AND the underlying
// mission_runtime_missions run, with no further user action required.
import durableMissionRuntime from './durable-mission-runtime-service.js';
import onboardingStateMachine from './nexora-onboarding-state-machine.js';
import onboardingOAuth, { insertAuthorizationSession } from './nexora-onboarding-oauth-service.js';

const uuid = () => crypto.randomUUID();
async function hash(value) {
	const bytes = new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value));
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
	return { ok: true, missionId, authorizationUrl: session.authorizationUrl, sessionId: session.row.id, expiresAt: session.row.expires_at, state: session.state, verifier: session.verifier };
}

// Consumes a real provider callback and automatically resumes the originating Mission — no
// user action required beyond the provider consent screen itself. The Mission's underlying
// mission_runtime_runs lease is claimed here (real, fenced, per durable-mission-runtime-service)
// so this is restart-safe the same way every other Mission Runtime step is.
async function handleCallback(c, scope, { state, verifier, callbackFingerprint }) {
	const consumption = await onboardingOAuth.consumeCallback(c, scope, { state, verifier, receivedCallbackFingerprint: callbackFingerprint });
	if (!consumption.ok) return { ok: false, reason: consumption.reason };
	if (consumption.duplicate) return { ok: true, duplicate: true, resumeCheckpoint: consumption.resumeCheckpoint };

	const missionId = consumption.onboardingMissionId;
	const phaseRow = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(missionId, scope.tenantId, scope.workspaceId).first();
	if (!phaseRow) return { ok: false, reason: 'ONBOARDING_STATE_NOT_FOUND' };
	if (onboardingStateMachine.allowed(phaseRow.phase, 'waiting_for_user_consent')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'waiting_for_user_consent' });
	const afterConsent = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
	if (onboardingStateMachine.allowed(afterConsent.phase, 'authorization_received')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'authorization_received' });

	// Automatic Mission continuation: claim/advance the underlying durable Mission run so the
	// caller never has to separately "resume" anything.
	const runId = `onboarding-run:${missionId}`;
	await c.env.db.prepare(`INSERT OR IGNORE INTO mission_runtime_runs(id,mission_id,tenant_id,workspace_id,state) VALUES(?1,?2,?3,?4,'runnable')`).bind(runId, missionId, scope.tenantId, scope.workspaceId).run();
	const run = await durableMissionRuntime.claimRun(c, scope, runId).catch(() => null);
	if (run) {
		await c.env.db.prepare(`UPDATE mission_runtime_missions SET state='running',version=version+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND state='runnable'`).bind(missionId, scope.tenantId, scope.workspaceId).run();
	}

	return { ok: true, duplicate: false, missionId, resumeCheckpoint: consumption.resumeCheckpoint, phase: (await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first()).phase, missionResumed: Boolean(run) };
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
