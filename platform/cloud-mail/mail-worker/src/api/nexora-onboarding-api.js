// NEXORA Zero-Touch onboarding: start + callback HTTP surface. Wires the already-tested
// createAuthorizationSession/consumeCallback/advancePhase logic to real requests. The PKCE
// verifier is expected from the client-side redirect-completion page (retrieved from the
// short-lived client session that originated the request, e.g. sessionStorage set at
// /v3/onboarding/start time) — never persisted server-side in cleartext, per ADR-6.
import app from '../hono/hono';
import result from '../model/result';
import userContext from '../security/user-context';
import onboardingOrchestrator from '../service/nexora-onboarding-orchestrator-service';

app.post('/v3/onboarding/start', async (c) => {
	const tenantId = userContext.getUserId(c);
	const q = c.req.query();
	const body = await c.req.json().catch(() => ({}));
	const workspaceId = Number(q.workspace_id || body.workspace_id);
	const provider = String(body.provider || '');
	const capabilities = Array.isArray(body.capabilities) ? body.capabilities : ['mail_read'];
	const idempotencyKey = String(body.idempotency_key || `${provider}:${capabilities.join(',')}`);
	const data = await onboardingOrchestrator.startOnboarding(c, { tenantId, workspaceId }, { provider, capabilities, idempotencyKey, tenantHint: body.tenant_hint || null, loginHint: body.login_hint || null });
	// The PKCE verifier must never be returned in a JSON response body (readable by any XSS on
	// the page) -- it goes only into an httpOnly, Secure, short-lived cookie scoped to this
	// onboarding session, mirroring the codebase's existing Set-Cookie pattern (login-api.js).
	const { verifier, ...safeData } = data;
	if (data.ok && verifier) c.header('Set-Cookie', `nexora_pkce_verifier=${verifier}; HttpOnly; Secure; SameSite=Lax; Max-Age=600; Path=/v3/onboarding`);
	c.header('Cache-Control', 'private, no-store');
	return c.json(result.ok(safeData));
});

app.post('/v3/onboarding/callback', async (c) => {
	const tenantId = userContext.getUserId(c);
	const q = c.req.query();
	const body = await c.req.json().catch(() => ({}));
	const workspaceId = Number(q.workspace_id || body.workspace_id);
	const data = await onboardingOrchestrator.handleCallback(c, { tenantId, workspaceId }, { state: String(body.state || ''), verifier: String(body.code_verifier || ''), callbackFingerprint: body.callback_fingerprint || null });
	return c.json(result.ok(data));
});

export default app;
