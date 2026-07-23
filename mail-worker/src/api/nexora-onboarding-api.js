// NEXORA Zero-Touch onboarding HTTP surface (Required Output #6). Wires the already-tested
// service-layer logic (discoverProvider/createAuthorizationSession/consumeCallback/
// advancePhase/resumeOnboarding/cancelOnboarding/repairOnboarding) to real requests. All
// routes go through the SAME global auth middleware as every other CloudMail API (see
// nexora-onboarding-http-routes.test.mjs) -- no separate onboarding authority.
import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import onboardingOrchestrator from '../service/nexora-onboarding-orchestrator-service';
import { providerEnv } from '../service/nexora-onboarding-oauth-service.js';
import providerDiscovery from '../service/nexora-onboarding-provider-discovery-service';
import missionRuntimeStatusService from '../service/mission-runtime-status-service';
import connectionRuntime from '../service/connection-runtime-service.js';

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
	const capabilities = Array.isArray(body.capabilities) ? body.capabilities : ['mail_read'];
	const idempotencyKey = String(body.idempotency_key || `${provider}:${capabilities.join(',')}`);
	const connectionRuntimeEnabled = String(c.env.NEXORA_CONNECTION_RUNTIME_ENABLED || 'false').toLowerCase() === 'true';
	if (connectionRuntimeEnabled && !hasConnectionRuntimeAuthority(body)) return c.json(result.fail('CONNECTION_RUNTIME_AUTHORITY_REQUIRED', 400), 400);
	let loginHint = body.login_hint || null;
	if (body.account_id) {
		const canonicalAccount = await c.env.db.prepare(`SELECT a.email,lower(a.provider) AS provider FROM account a JOIN workspace_account_bindings b ON b.account_id=a.account_id AND b.workspace_id=?2 WHERE a.account_id=?3 AND a.user_id=?1 AND a.is_del=0`).bind(tenantId, workspaceId, Number(body.account_id)).first();
		if (!canonicalAccount || !['gmail','google'].includes(canonicalAccount.provider) || provider !== 'google') return c.json(result.fail('ACCOUNT_PROVIDER_AUTHORITY_DENIED', 403), 403);
		loginHint = canonicalAccount.email;
	}
	const runtimeAuthorityInput = connectionRuntimeEnabled ? { tenant_id: tenantId, workspace_id: workspaceId, actor_user_id: tenantId, account_id: Number(body.account_id), authority_generation: Number(body.authority_generation), provider } : null;
	if (runtimeAuthorityInput) connectionRuntime.assertRollout(c.env, runtimeAuthorityInput);
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
	const q = c.req.query();
	const verifier = readCookie(c, 'nexora_pkce_verifier') || '';
	const redirectUri = providerEnv(c.env, expectedProvider, 'redirectUriEnv');
	// Provider redirects are deliberately not scoped from query parameters, the active UI
	// workspace, or the logged-in user.  `state` resolves exactly one durable correlation row.
	const data = await onboardingOrchestrator.handleCallback(c, null, {
		state: String(q.state || ''), verifier, code: q.code ? String(q.code) : null, redirectUri,
		callbackFingerprint: q.code ? await callbackFingerprint(String(q.code)) : null, expectedProvider,
		fetchImpl: c.env?.[PROVIDER_CALLBACK_TEST_FETCH],
		jwksFetchImpl: c.env?.[PROVIDER_CALLBACK_TEST_JWKS_FETCH],
	});
	if (data.ok) c.header('Set-Cookie', `nexora_pkce_verifier=; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Path=/v3/onboarding`); // single-use, clear immediately
	c.header('Cache-Control', 'private, no-store');
	return c.json(result.ok({ ...data, provider: expectedProvider }));
}
app.get('/v3/onboarding/providers/google/callback', (c) => handleProviderCallback(c, 'google'));
app.get('/v3/onboarding/providers/microsoft/callback', (c) => handleProviderCallback(c, 'microsoft'));

// Kept for direct/test-mode POST-based callback delivery (e.g. a client-side redirect
// completion page that already has code_verifier in hand, per ADR-6) alongside the real
// provider GET redirect routes above.
app.post('/v3/onboarding/callback', async (c) => {
	if (String(c.env.NEXORA_ENABLE_LEGACY_POST_CALLBACK || 'false').toLowerCase() !== 'true') return c.json(result.fail('LEGACY_POST_CALLBACK_DISABLED'), 404);
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
