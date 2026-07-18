// NEXORA Zero-Touch onboarding orchestrator: ties the Durable Mission Runtime (generic mission
// state), the onboarding-specific 18-state phase machine, and the OAuth/authorization-session
// contract into the single "start onboarding" / "handle callback" surface a UI or callback
// route calls. This is the automatic-Mission-continuation implementation (Required Output #20,
// ADR-8): a valid callback advances both the onboarding phase AND the underlying
// mission_runtime_missions run, with no further user action required.
import durableMissionRuntime from './durable-mission-runtime-service.js';
import onboardingStateMachine from './nexora-onboarding-state-machine.js';
import onboardingOAuth, { insertAuthorizationSession, validateGrantedScopes, validateIdentity, validateMicrosoftTenant } from './nexora-onboarding-oauth-service.js';
import tokenExchange, { decodeIdTokenClaims } from './nexora-onboarding-token-exchange-service.js';
import tokenStorage from './nexora-onboarding-token-storage-service.js';
import onboardingSync from './nexora-onboarding-sync-service.js';

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
async function handleCallback(c, scope, { state, verifier, code = null, redirectUri = null, callbackFingerprint, fetchImpl, loginHint = null, allowedMicrosoftTenantIds = [] }) {
	const consumption = await onboardingOAuth.consumeCallback(c, scope, { state, verifier, receivedCallbackFingerprint: callbackFingerprint });
	if (!consumption.ok) return { ok: false, reason: consumption.reason };
	if (consumption.duplicate) {
		// Restart-safety fix: a session can legitimately be 'consumed' while no token was ever
		// stored, if the process was evicted between exchangeAuthorizationCode() succeeding and
		// storeTokens() completing (both are plain sequential awaits with no intermediate
		// checkpoint -- nothing running in memory survives a Worker eviction). Rather than
		// stranding the Mission, a resupplied `code` on the "duplicate" delivery is used to
		// retry the exchange+storage steps instead of short-circuiting. A genuinely-already-
		// stored token (the normal duplicate-delivery case) is still a true no-op.
		const missionId = consumption.onboardingMissionId;
		const alreadyStored = missionId ? await c.env.db.prepare(`SELECT 1 FROM nexora_onboarding_tokens WHERE onboarding_mission_id=?1`).bind(missionId).first() : null;
		if (alreadyStored || !code || !redirectUri || !missionId) {
			return { ok: true, duplicate: true, resumeCheckpoint: consumption.resumeCheckpoint };
		}
		// Fall through to the exchange path below using the resupplied code -- this mission was
		// never actually completed.
		return handleCallbackExchange(c, scope, { missionId, provider: consumption.provider, code, verifier, redirectUri, fetchImpl, loginHint, allowedMicrosoftTenantIds, resumeCheckpoint: consumption.resumeCheckpoint, run: await reclaimMissionRun(c, scope, missionId) });
	}

	const missionId = consumption.onboardingMissionId;
	const provider = consumption.provider;
	const phaseRow = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(missionId, scope.tenantId, scope.workspaceId).first();
	if (!phaseRow) return { ok: false, reason: 'ONBOARDING_STATE_NOT_FOUND' };
	if (onboardingStateMachine.allowed(phaseRow.phase, 'waiting_for_user_consent')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'waiting_for_user_consent' });
	const afterConsent = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
	if (onboardingStateMachine.allowed(afterConsent.phase, 'authorization_received')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'authorization_received' });

	const run = await reclaimMissionRun(c, scope, missionId);
	return handleCallbackExchange(c, scope, { missionId, provider, code, verifier, redirectUri, fetchImpl, loginHint, allowedMicrosoftTenantIds, resumeCheckpoint: consumption.resumeCheckpoint, run });
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
// sync continuation using the REAL provider adapter contract, with identity and (for
// Microsoft) tenant validation actually enforced against the decoded id_token before any
// token is trusted -- not just available as an untested helper. Shared by both the normal
// callback path and the restart-safe duplicate-retry path in handleCallback() above, so a
// Worker eviction between exchange and storage is recoverable via a resupplied callback
// rather than stranding the Mission.
async function handleCallbackExchange(c, scope, { missionId, provider, code, verifier, redirectUri, fetchImpl, loginHint, allowedMicrosoftTenantIds, resumeCheckpoint, run }) {
	let tokenExchangeResult = null;
	let capabilityStatus = null;
	let syncDispatched = false;
	if (code && redirectUri) {
		tokenExchangeResult = await tokenExchange.exchangeAuthorizationCode(c.env, { provider, code, verifier, redirectUri }, fetchImpl);
		if (tokenExchangeResult.ok) {
			const claims = decodeIdTokenClaims(tokenExchangeResult.idToken);
			const identityResult = validateIdentity({ expectedLoginHint: loginHint, providerSubject: claims?.sub, providerEmail: claims?.email });
			const tenantResult = provider === 'microsoft' ? validateMicrosoftTenant({ allowedTenantIds: allowedMicrosoftTenantIds, observedTenantId: claims?.tid }) : { valid: true };

			if (!identityResult.valid || !tenantResult.valid) {
				// A real, precise conflict -- never silently proceed with a mismatched identity
				// or a disallowed tenant, and never store the token for it.
				const current = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
				if (onboardingStateMachine.allowed(current.phase, 'validating_authority')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'validating_authority' });
				const revalidated = await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first();
				if (onboardingStateMachine.allowed(revalidated.phase, 'blocked')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'blocked', blockedReason: !identityResult.valid ? identityResult.reason : tenantResult.reason, requiredHumanActor: 'end_user' });
				return { ok: true, duplicate: false, missionId, resumeCheckpoint, phase: (await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first()).phase, missionResumed: Boolean(run), tokenExchangeAttempted: true, tokenExchangeOk: true, identityValid: false, capabilityStatus: null, syncDispatched: false };
			}

			await tokenStorage.storeTokens(c, scope, { onboardingMissionId: missionId, provider, providerAccountHash: await hash(claims?.sub || `${provider}:${missionId}`), refreshToken: tokenExchangeResult.refreshToken || '', accessToken: tokenExchangeResult.accessToken, accessTokenExpiresAt: tokenExchangeResult.expiresAt, grantedScopes: tokenExchangeResult.grantedScopes });

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

			if (capabilityStatus === 'SUPPORTED') {
				const dispatch = await onboardingSync.dispatchInitialSync(c, scope, { missionId, capabilityStates: { mail_read: 'SUPPORTED' } }).catch((error) => ({ dispatched: false, error: String(error?.message || error) }));
				syncDispatched = Boolean(dispatch?.dispatched);
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
			if (onboardingStateMachine.allowed(current.phase, 'failed')) await onboardingStateMachine.advancePhase(c, scope, { missionId, to: 'failed', blockedReason: tokenExchangeResult.errorCode });
		}
	}

	return { ok: true, duplicate: false, missionId, resumeCheckpoint, phase: (await c.env.db.prepare(`SELECT phase FROM nexora_onboarding_state WHERE mission_id=?1`).bind(missionId).first()).phase, missionResumed: Boolean(run), tokenExchangeAttempted: Boolean(code), tokenExchangeOk: tokenExchangeResult?.ok ?? null, capabilityStatus, syncDispatched };
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
