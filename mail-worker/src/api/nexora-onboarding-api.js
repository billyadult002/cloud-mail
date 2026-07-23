// NEXORA Zero-Touch onboarding HTTP surface (Required Output #6). Wires the already-tested
// service-layer logic (discoverProvider/createAuthorizationSession/consumeCallback/
// advancePhase/resumeOnboarding/cancelOnboarding/repairOnboarding) to real requests. All
// routes go through the SAME global auth middleware as every other CloudMail API (see
// nexora-onboarding-http-routes.test.mjs) -- no separate onboarding authority.
import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import onboardingOrchestrator from '../service/nexora-onboarding-orchestrator-service';
import onboardingOAuth, { providerEnv } from '../service/nexora-onboarding-oauth-service.js';
import providerDiscovery from '../service/nexora-onboarding-provider-discovery-service';
import missionRuntimeStatusService from '../service/mission-runtime-status-service';
import connectionRuntime from '../service/connection-runtime-service.js';
import callbackIntake from '../service/nexora-oauth-callback-intake-service.js';
import enterpriseAuthority from '../service/enterprise-authority-service.js';

const PROVIDER_CALLBACK_TEST_FETCH = Symbol.for('nexora.internal.providerCallbackFetch');
const PROVIDER_CALLBACK_TEST_JWKS_FETCH = Symbol.for('nexora.internal.providerCallbackJwksFetch');

function hasConnectionRuntimeAuthority(body) {
	return body.account_id !== undefined && body.account_id !== null
		&& body.authority_generation !== undefined && body.authority_generation !== null;
}

function readCookie(c, name) {
	const header = c.req.header('Cookie') || '';
	for (const part of header.split(';')) {
		const idx = part.indexOf('=');
		if (idx === -1) continue;
		if (part.slice(0, idx).trim() === name) return decodeURIComponent(part.slice(idx + 1).trim());
	}
	return null;
}

async function callbackFingerprint(code) {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code));
	return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function applyOAuthBrowserSecurityHeaders(c) {
	c.header('Cache-Control', 'private, no-store, max-age=0');
	c.header('Pragma', 'no-cache');
	c.header('Referrer-Policy', 'no-referrer');
	c.header('Content-Security-Policy', "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
	c.header('X-Content-Type-Options', 'nosniff');
}

app.post('/v3/onboarding/discover', async (c) => {
	const tenantId = userContext.getUserId(c);
	const q = c.req.query();
	const body = await c.req.json().catch(() => ({}));
	const workspaceId = Number(q.workspace_id || body.workspace_id);
	// Discovery is safe, non-secret metadata evaluation -- no provider is contacted here.
	const data = await providerDiscovery.discoverProvider(c, { tenantId, workspaceId }, { onboardingMissionId: String(body.onboarding_mission_id || 'discovery-only'), email: body.email || null, existingConnectionProvider: body.existing_connection_provider || null, organizationPolicyProvider: body.organization_policy_provider || null, microsoftTenantHint: body.microsoft_tenant_hint || null, capabilityProbeResult: body.capability_probe_result || null });
	return c.json(result.ok(data));
});

app.post('/v3/onboarding/start', async (c) => {
	const tenantId = userContext.getUserId(c);
	const q = c.req.query();
	const body = await c.req.json().catch(() => ({}));
	const workspaceId = Number(q.workspace_id || body.workspace_id);
	const provider = String(body.provider || '');
	if (String(c.env.NEXORA_OAUTH_AUTHORIZATION_CREATION_ENABLED || 'false').toLowerCase() !== 'true') {
		return c.json(result.fail('OAUTH_AUTHORIZATION_CREATION_DISABLED', 503), 503);
	}
	const capabilities = Array.isArray(body.capabilities) ? body.capabilities : ['mail_read'];
	const idempotencyKey = String(body.idempotency_key || `${provider}:${capabilities.join(',')}`);
	const connectionRuntimeEnabled = String(c.env.NEXORA_CONNECTION_RUNTIME_ENABLED || 'false').toLowerCase() === 'true';
	if (connectionRuntimeEnabled && !hasConnectionRuntimeAuthority(body)) return c.json(result.fail('CONNECTION_RUNTIME_AUTHORITY_REQUIRED', 400), 400);
	let loginHint = body.login_hint || null;
	if (body.account_id) {
		const canonicalAccount = await c.env.db.prepare(`SELECT a.email,lower(a.provider) AS provider FROM account a JOIN workspace_account_bindings b ON b.account_id=a.account_id AND b.workspace_id=?1 WHERE a.account_id=?2 AND a.is_del=0`).bind(workspaceId, Number(body.account_id)).first();
		if (!canonicalAccount || !['gmail','google'].includes(canonicalAccount.provider) || provider !== 'google') return c.json(result.fail('ACCOUNT_PROVIDER_AUTHORITY_DENIED', 403), 403);
		loginHint = canonicalAccount.email;
	}
	const runtimeAuthorityInput = connectionRuntimeEnabled ? { tenant_id: tenantId, workspace_id: workspaceId, actor_user_id: tenantId, account_id: Number(body.account_id), authority_generation: Number(body.authority_generation), provider } : null;
	let initialLiveActorAuthority = null;
	if (runtimeAuthorityInput) {
		connectionRuntime.assertRollout(c.env, runtimeAuthorityInput);
		initialLiveActorAuthority = await enterpriseAuthority.resolveAccountAuthority(c, {
			workspaceId,
			actingUserId: tenantId,
			accountId: runtimeAuthorityInput.account_id,
			capability: 'account_state_visibility',
		});
		if (!initialLiveActorAuthority.allowed
			|| Number(initialLiveActorAuthority.authorityGeneration) !== Number(runtimeAuthorityInput.authority_generation)) {
			return c.json(result.fail('ACCOUNT_RUNTIME_AUTHORITY_DENIED', 403), 403);
		}
	}
	const data = await onboardingOrchestrator.startOnboarding(c, { tenantId, workspaceId }, { provider, capabilities, idempotencyKey, tenantHint: body.tenant_hint || null, loginHint });
	if (data.ok && connectionRuntimeEnabled) {
		const runtimeInput = { ...runtimeAuthorityInput, onboarding_mission_id: data.missionId, idempotency_key: `connection:${idempotencyKey}` };
		const discovered = await connectionRuntime.discoverConnection(c, runtimeInput);
		const authorizationInput = { ...runtimeInput, connection_id: discovered.id, idempotency_key: `authorization:${data.sessionId}` };
		let authorization = data.idempotentReplay && discovered.state === 'AUTHORIZATION_PENDING'
			? await connectionRuntime.findAuthorizationReplay(c, authorizationInput, { authorizationSessionId: data.sessionId })
			: null;
		if (!authorization && discovered.state === 'AUTHORIZATION_PENDING') {
			await connectionRuntime.recoverExpiredAuthorization(c, authorizationInput, { replacementAuthorizationSessionId: data.sessionId });
		}
		if (!authorization) authorization = await connectionRuntime.beginAuthorization(c, authorizationInput, { authorizationSessionId: data.sessionId });
		const bindingTable = await c.env.db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='nexora_oauth_authorization_session_bindings'`).first().catch(() => null);
		if (bindingTable) {
			const liveActorAuthority = await enterpriseAuthority.resolveAccountAuthority(c, {
				workspaceId,
				actingUserId: tenantId,
				accountId: runtimeAuthorityInput.account_id,
				capability: 'account_state_visibility',
			});
			if (!liveActorAuthority.allowed
				|| Number(liveActorAuthority.authorityGeneration) !== Number(runtimeAuthorityInput.authority_generation)) {
				throw new Error('nexora_oauth_authorization_session_live_actor_binding_denied');
			}
			const bound = await c.env.db.prepare(
				`UPDATE nexora_oauth_authorization_session_bindings
				 SET runtime_mode='CONNECTION_RUNTIME',
				     connection_id=?2,connection_generation=?3,authority_generation=?4,
				     account_id=?5,account_owner_user_id=?6,
				     domain_authority_id=?7,domain_authority_generation=?8,
				     authority_kind=?9,membership_authority_id=?10,membership_authority_generation=?11,
				     delegation_authority_id=?12,delegation_authority_generation=?13,
				     updated_at=CURRENT_TIMESTAMP
				 WHERE authorization_session_id=?1 AND tenant_id=?14 AND workspace_id=?15
				   AND provider=?16 AND connection_id IS NULL`
			).bind(
				data.sessionId,
				discovered.id,
				authorization.connectionGeneration,
				runtimeAuthorityInput.authority_generation,
				runtimeAuthorityInput.account_id,
				liveActorAuthority.ownerUserId,
				discovered.domain_authority_id,
				discovered.domain_authority_generation,
				liveActorAuthority.authorityKind,
				liveActorAuthority.membershipAuthorityId,
				liveActorAuthority.membershipAuthorityGeneration,
				liveActorAuthority.delegationAuthorityId,
				liveActorAuthority.delegationAuthorityGeneration,
				tenantId,
				workspaceId,
				provider,
			).run();
			const canonicalBinding = await c.env.db.prepare(
				`SELECT runtime_mode,connection_id,connection_generation,authority_generation,account_id,account_owner_user_id,
				        domain_authority_id,domain_authority_generation,authority_kind,membership_authority_id,
				        membership_authority_generation,delegation_authority_id,delegation_authority_generation
				 FROM nexora_oauth_authorization_session_bindings b
				 JOIN nexora_oauth_live_authorization_bindings la
				   ON la.authorization_session_id=b.authorization_session_id
				 WHERE b.authorization_session_id=?1`
			).bind(data.sessionId).first();
			if ((!bound.meta?.changes && !canonicalBinding)
				|| canonicalBinding.runtime_mode !== 'CONNECTION_RUNTIME'
				|| canonicalBinding.connection_id !== discovered.id
				|| Number(canonicalBinding.connection_generation) !== Number(authorization.connectionGeneration)
				|| Number(canonicalBinding.authority_generation) !== Number(runtimeAuthorityInput.authority_generation)
				|| Number(canonicalBinding.account_id) !== Number(runtimeAuthorityInput.account_id)
				|| Number(canonicalBinding.account_owner_user_id) !== Number(liveActorAuthority.ownerUserId)
				|| canonicalBinding.domain_authority_id !== discovered.domain_authority_id
				|| Number(canonicalBinding.domain_authority_generation) !== Number(discovered.domain_authority_generation)
				|| canonicalBinding.authority_kind !== liveActorAuthority.authorityKind
				|| (canonicalBinding.membership_authority_id || null) !== (liveActorAuthority.membershipAuthorityId || null)
				|| Number(canonicalBinding.membership_authority_generation || 0) !== Number(liveActorAuthority.membershipAuthorityGeneration || 0)
				|| (canonicalBinding.delegation_authority_id || null) !== (liveActorAuthority.delegationAuthorityId || null)
				|| Number(canonicalBinding.delegation_authority_generation || 0) !== Number(liveActorAuthority.delegationAuthorityGeneration || 0)) {
				throw new Error('nexora_oauth_authorization_session_runtime_binding_conflict');
			}
			if (initialLiveActorAuthority.authorityKind !== liveActorAuthority.authorityKind
				|| (initialLiveActorAuthority.delegationAuthorityId || null) !== (liveActorAuthority.delegationAuthorityId || null)
				|| Number(initialLiveActorAuthority.delegationAuthorityGeneration || 0) !== Number(liveActorAuthority.delegationAuthorityGeneration || 0)) {
				throw new Error('nexora_oauth_authorization_session_actor_authority_changed');
			}
		}
		data.connection = { id: authorization.connectionId, state: authorization.state, generation: authorization.connectionGeneration };
	}
	// The PKCE verifier must never be returned in a JSON response body (readable by any XSS on
	// the page) -- it goes only into an httpOnly, Secure, short-lived cookie scoped to this
	// onboarding session, mirroring the codebase's existing Set-Cookie pattern (login-api.js).
	const { verifier, ...safeData } = data;
	if (data.ok && verifier) c.header('Set-Cookie', `nexora_pkce_verifier=${verifier}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/v3/onboarding`);
	c.header('Cache-Control', 'private, no-store');
	return c.json(result.ok(safeData));
});

app.get('/v3/onboarding/status/:missionId', async (c) => {
	const tenantId = userContext.getUserId(c);
	const q = c.req.query();
	const data = await missionRuntimeStatusService.missionStatus(c, { tenantId, workspaceId: Number(q.workspace_id) }, c.req.param('missionId'));
	return c.json(result.ok(data));
});

async function handleProviderCallback(c, expectedProvider) {
	// Google and Microsoft web-server callbacks necessarily arrive with query parameters.
	// This endpoint consumes them only in server memory and always terminates the navigation
	// with a fixed, queryless 303. No callback value is rendered or copied into a client state.
	try {
		const q = c.req.query();
		const verifier = readCookie(c, 'nexora_pkce_verifier') || '';
		const redirectUri = providerEnv(c.env, expectedProvider, 'redirectUriEnv');
		const state = String(q.state || '');
		const code = q.code ? String(q.code) : null;
		const intakeEnabled = await callbackIntake.tableAvailable(c);
		if (intakeEnabled) {
			if (!state || !verifier || !code || !redirectUri) throw new Error('CALLBACK_INPUT_INCOMPLETE');
			const consumption = await onboardingOAuth.consumeCallback(c, null, {
				state,
				verifier,
				receivedCallbackFingerprint: await callbackFingerprint(code),
				expectedProvider,
			});
			if (!consumption.ok) throw new Error(consumption.reason);
			if (!consumption.duplicate) {
				const intake = await callbackIntake.sealCallback(c, consumption, { code, verifier, redirectUri });
				const executionCtx = c.executionCtx;
				const processingEnabled = String(c.env.NEXORA_OAUTH_CALLBACK_PROCESSING_ENABLED || 'false').toLowerCase() === 'true';
				if (processingEnabled && executionCtx?.waitUntil) {
					executionCtx.waitUntil(callbackIntake.processIntake({ env: c.env }, intake.id, (workerContext, row, payload) => onboardingOrchestrator.processConsumedCallbackIntake(workerContext, row, payload, {
						fetchImpl: c.env?.[PROVIDER_CALLBACK_TEST_FETCH],
						jwksFetchImpl: c.env?.[PROVIDER_CALLBACK_TEST_JWKS_FETCH],
					})).catch(() => null));
				}
			}
		} else {
			// Code-first deployment is fail-closed for every runtime mode. The callback
			// cannot reach the provider exchange path until migration 0084 and its durable
			// intake authority exist.
			throw new Error('OAUTH_REMEDIATION_SCHEMA_REQUIRED');
		}
	} catch {
		// The browser gets the same clean completion surface for success, denial, expiry,
		// provider error, and internal failure. Operational diagnosis uses redacted durable
		// state, never callback parameters or provider error descriptions.
	} finally {
		c.header('Set-Cookie', `nexora_pkce_verifier=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/v3/onboarding`);
		applyOAuthBrowserSecurityHeaders(c);
	}
	return c.redirect(`/v3/onboarding/providers/${expectedProvider}/result`, 303);
}
app.get('/v3/onboarding/providers/google/callback', (c) => handleProviderCallback(c, 'google'));
app.get('/v3/onboarding/providers/microsoft/callback', (c) => handleProviderCallback(c, 'microsoft'));
function cleanProviderResult(c) {
	applyOAuthBrowserSecurityHeaders(c);
	return c.html('<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><title>CloudMail authorization</title></head><body><main>Authorization processing is complete. Return to CloudMail.</main></body></html>');
}
app.get('/v3/onboarding/providers/google/result', cleanProviderResult);
app.get('/v3/onboarding/providers/microsoft/result', cleanProviderResult);

// Kept for direct/test-mode POST-based callback delivery (e.g. a client-side redirect
// completion page that already has code_verifier in hand, per ADR-6) alongside the real
// provider GET redirect routes above.
app.post('/v3/onboarding/callback', async (c) => {
	if (String(c.env.NEXORA_ENABLE_LEGACY_POST_CALLBACK || 'false').toLowerCase() !== 'true') return c.json(result.fail('LEGACY_POST_CALLBACK_DISABLED'), 404);
	if (String(c.env.NEXORA_CONNECTION_RUNTIME_ENABLED || 'false').toLowerCase() === 'true') return c.json(result.fail('LEGACY_POST_CALLBACK_DISABLED_FOR_CONNECTION_RUNTIME'), 404);
	const tenantId = userContext.getUserId(c);
	const q = c.req.query();
	const body = await c.req.json().catch(() => ({}));
	const workspaceId = Number(q.workspace_id || body.workspace_id);
	const provider = String(body.provider || '');
	const redirectUri = providerEnv(c.env, provider, 'redirectUriEnv');
	const data = await onboardingOrchestrator.handleCallback(c, { tenantId, workspaceId }, { state: String(body.state || ''), verifier: String(body.code_verifier || ''), code: body.code ? String(body.code) : null, redirectUri, callbackFingerprint: body.callback_fingerprint || null, expectedProvider: provider || null });
	return c.json(result.ok(data));
});

app.post('/v3/onboarding/resume/:missionId', async (c) => {
	const tenantId = userContext.getUserId(c);
	const q = c.req.query();
	const data = await onboardingOrchestrator.resumeOnboarding(c, { tenantId, workspaceId: Number(q.workspace_id) }, { missionId: c.req.param('missionId') });
	return c.json(result.ok(data));
});

app.post('/v3/onboarding/cancel/:missionId', async (c) => {
	const tenantId = userContext.getUserId(c);
	const q = c.req.query();
	const data = await onboardingOrchestrator.cancelOnboarding(c, { tenantId, workspaceId: Number(q.workspace_id) }, { missionId: c.req.param('missionId') });
	return c.json(result.ok(data));
});

app.post('/v3/onboarding/repair/:missionId', async (c) => {
	const tenantId = userContext.getUserId(c);
	const q = c.req.query();
	const data = await onboardingOrchestrator.repairOnboarding(c, { tenantId, workspaceId: Number(q.workspace_id) }, { missionId: c.req.param('missionId') });
	return c.json(result.ok(data));
});

export default app;
export { hasConnectionRuntimeAuthority };
