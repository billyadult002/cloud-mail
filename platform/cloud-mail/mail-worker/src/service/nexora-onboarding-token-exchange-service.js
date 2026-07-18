// NEXORA Zero-Touch onboarding: real Google/Microsoft OAuth token-exchange HTTP calls
// (Required Output #2 of the Zero-Touch OAuth Logic Completion mission's largest remaining
// gap). `fetchImpl` is injected (defaults to global `fetch`) so this can be deterministically
// tested against fixture Response objects without a live network call or real credentials --
// the same pattern already used for the sync adapter in nexora-onboarding-sync-service.js.
// Never logs, returns in an error message, or otherwise surfaces the raw authorization code,
// client secret, access token, or refresh token -- callers pass the result straight into
// nexora-onboarding-token-storage-service.storeTokens(), which encrypts before persisting.
import { PROVIDERS } from './nexora-onboarding-oauth-service.js';

const CLIENT_SECRET_ENV = { google: 'NEXORA_GOOGLE_OAUTH_CLIENT_SECRET', microsoft: 'NEXORA_MICROSOFT_OAUTH_CLIENT_SECRET' };

function tokenEndpointFor(provider, tenantHint) {
	const spec = PROVIDERS[provider];
	if (!spec) throw new Error('nexora_onboarding_unsupported_provider');
	return spec.tokenEndpoint.replace('{tenant}', tenantHint || 'common');
}

// Decodes (does NOT cryptographically verify) the id_token's payload claims -- signature
// verification against the provider's JWKS is a real network/crypto dependency out of this
// pass's logic-complete scope (same distinction as the token endpoint itself). This is
// sufficient to wire identity (`sub`/`email`) and Microsoft tenant (`tid`) binding logic
// deterministically; a production hardening pass should add JWKS signature verification
// before treating these claims as fully authoritative.
function decodeIdTokenClaims(idToken) {
	if (!idToken) return null;
	const parts = String(idToken).split('.');
	if (parts.length !== 3) return null;
	try {
		const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/');
		const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
		return JSON.parse(atob(padded));
	} catch {
		return null;
	}
}

async function parseTokenResponse(response) {
	let body;
	try {
		body = await response.json();
	} catch {
		return { ok: false, errorCode: 'invalid_response', errorDescription: 'Provider token endpoint returned a non-JSON body.' };
	}
	if (!response.ok || body.error) {
		return { ok: false, errorCode: body.error || `http_${response.status}`, errorDescription: (body.error_description || '').slice(0, 200), httpStatus: response.status };
	}
	if (!body.access_token) return { ok: false, errorCode: 'missing_access_token', httpStatus: response.status };
	return {
		ok: true,
		accessToken: body.access_token,
		refreshToken: body.refresh_token || null, // Google omits this on refresh calls; Microsoft always returns one (rotation)
		expiresAt: new Date(Date.now() + Number(body.expires_in || 3600) * 1000).toISOString(),
		grantedScopes: typeof body.scope === 'string' ? body.scope.split(/\s+/).filter(Boolean) : [],
		idToken: body.id_token || null,
	};
}

// Authorization Code + PKCE exchange -- the code_verifier (not the client secret alone) is
// what proves this exchange request came from the party that started the authorization
// session, per RFC 7636. clientId/clientSecret/verifier are read from the caller-supplied env
// at call time only; never logged.
async function exchangeAuthorizationCode(env, { provider, code, verifier, redirectUri, tenantHint = null }, fetchImpl = fetch) {
	const spec = PROVIDERS[provider];
	if (!spec) throw new Error('nexora_onboarding_unsupported_provider');
	const clientId = env?.[spec.clientIdEnv];
	const clientSecret = env?.[CLIENT_SECRET_ENV[provider]];
	if (!clientId) return { ok: false, errorCode: 'PROVIDER_APPLICATION_MISSING' };

	const params = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier });
	if (clientSecret) params.set('client_secret', clientSecret); // confidential client; PKCE alone would suffice for a public client

	let response;
	try {
		response = await fetchImpl(tokenEndpointFor(provider, tenantHint), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() });
	} catch (error) {
		return { ok: false, errorCode: 'network_error', errorDescription: String(error?.message || error).slice(0, 200) };
	}
	return parseTokenResponse(response);
}

async function refreshAccessToken(env, { provider, refreshToken, tenantHint = null }, fetchImpl = fetch) {
	const spec = PROVIDERS[provider];
	if (!spec) throw new Error('nexora_onboarding_unsupported_provider');
	const clientId = env?.[spec.clientIdEnv];
	const clientSecret = env?.[CLIENT_SECRET_ENV[provider]];
	if (!clientId) return { ok: false, errorCode: 'PROVIDER_APPLICATION_MISSING' };

	const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
	if (clientSecret) params.set('client_secret', clientSecret);

	let response;
	try {
		response = await fetchImpl(tokenEndpointFor(provider, tenantHint), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() });
	} catch (error) {
		return { ok: false, errorCode: 'network_error', errorDescription: String(error?.message || error).slice(0, 200) };
	}
	return parseTokenResponse(response);
}

export { CLIENT_SECRET_ENV, tokenEndpointFor, decodeIdTokenClaims };
export default { exchangeAuthorizationCode, refreshAccessToken };
