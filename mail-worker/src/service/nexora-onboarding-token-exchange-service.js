// NEXORA Zero-Touch onboarding: real Google/Microsoft OAuth token-exchange HTTP calls
// (Required Output #2 of the Zero-Touch OAuth Logic Completion mission's largest remaining
// gap). `fetchImpl` is injected (defaults to global `fetch`) so this can be deterministically
// tested against fixture Response objects without a live network call or real credentials --
// the same pattern already used for the sync adapter in nexora-onboarding-sync-service.js.
// Never logs, returns in an error message, or otherwise surfaces the raw authorization code,
// client secret, access token, or refresh token -- callers pass the result straight into
// nexora-onboarding-token-storage-service.storeTokens(), which encrypts before persisting.
import { PROVIDERS, providerEnv } from './nexora-onboarding-oauth-service.js';

const CLIENT_SECRET_ENV = Object.freeze({
	google: { primary: 'NEXORA_GOOGLE_OAUTH_CLIENT_SECRET', aliases: ['GOOGLE_OAUTH_CLIENT_SECRET'] },
	microsoft: { primary: 'NEXORA_MICROSOFT_OAUTH_CLIENT_SECRET', aliases: ['MICROSOFT_OAUTH_CLIENT_SECRET'] },
});

function clientSecret(env, provider) {
	const spec = CLIENT_SECRET_ENV[provider];
	if (!spec) return null;
	if (env?.[spec.primary]) return env[spec.primary];
	for (const alias of spec.aliases || []) {
		if (env?.[alias]) return env[alias];
	}
	return null;
}

function tokenEndpointFor(provider, tenantHint) {
	const spec = PROVIDERS[provider];
	if (!spec) throw new Error('nexora_onboarding_unsupported_provider');
	return spec.tokenEndpoint.replace('{tenant}', tenantHint || 'common');
}

const JWKS_ENDPOINTS = {
	google: () => 'https://www.googleapis.com/oauth2/v3/certs',
	microsoft: (tenantHint) => `https://login.microsoftonline.com/${encodeURIComponent(tenantHint || 'common')}/discovery/v2.0/keys`,
};

function base64UrlToBytes(value) {
	const padded = String(value || '').replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(value || '').length % 4)) % 4);
	return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

function decodeIdTokenClaims(idToken) {
	if (!idToken) return null;
	const parts = String(idToken).split('.');
	if (parts.length !== 3) return null;
	try {
		return JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[1])));
	} catch {
		return null;
	}
}

function decodeIdTokenHeader(idToken) {
	const parts = String(idToken || '').split('.');
	if (parts.length !== 3) return null;
	try {
		return JSON.parse(new TextDecoder().decode(base64UrlToBytes(parts[0])));
	} catch {
		return null;
	}
}

async function sha256Hex(value) {
	const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value || '')));
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function issuerValid(provider, claims) {
	if (provider === 'google') return claims.iss === 'accounts.google.com' || claims.iss === 'https://accounts.google.com';
	if (provider === 'microsoft') return typeof claims.iss === 'string' && /^https:\/\/login\.microsoftonline\.com\/[^/]+\/v2\.0$/.test(claims.iss);
	return false;
}

async function verifyIdTokenClaims(env, { provider, idToken, expectedNonceHash = null, tenantHint = null }, jwksFetchImpl = fetch) {
	const header = decodeIdTokenHeader(idToken);
	const claims = decodeIdTokenClaims(idToken);
	if (!header || !claims || header.alg !== 'RS256' || !header.kid) return { ok: false, errorCode: 'ID_TOKEN_MALFORMED' };
	const clientId = providerEnv(env, provider, 'clientIdEnv');
	if (!clientId) return { ok: false, errorCode: 'PROVIDER_APPLICATION_MISSING' };
	if (!issuerValid(provider, claims)) return { ok: false, errorCode: 'ID_TOKEN_ISSUER_INVALID' };
	if (claims.aud !== clientId && !(Array.isArray(claims.aud) && claims.aud.includes(clientId))) return { ok: false, errorCode: 'ID_TOKEN_AUDIENCE_INVALID' };
	const now = Math.floor(Date.now() / 1000);
	if (!Number.isFinite(Number(claims.exp)) || Number(claims.exp) <= now) return { ok: false, errorCode: 'ID_TOKEN_EXPIRED' };
	if (claims.nbf != null && Number(claims.nbf) > now + 60) return { ok: false, errorCode: 'ID_TOKEN_NOT_YET_VALID' };
	if (expectedNonceHash && await sha256Hex(claims.nonce || '') !== expectedNonceHash) return { ok: false, errorCode: 'ID_TOKEN_NONCE_MISMATCH' };

	let jwks;
	try {
		const response = await jwksFetchImpl(JWKS_ENDPOINTS[provider](tenantHint));
		jwks = await response.json();
	} catch {
		return { ok: false, errorCode: 'ID_TOKEN_JWKS_UNAVAILABLE' };
	}
	const jwk = (jwks.keys || []).find((key) => key.kid === header.kid && key.kty === 'RSA');
	if (!jwk) return { ok: false, errorCode: 'ID_TOKEN_SIGNING_KEY_NOT_FOUND' };
	let key;
	try {
		key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
	} catch {
		return { ok: false, errorCode: 'ID_TOKEN_SIGNING_KEY_INVALID' };
	}
	const [encodedHeader, encodedPayload, encodedSignature] = String(idToken).split('.');
	const signed = new TextEncoder().encode(`${encodedHeader}.${encodedPayload}`);
	const signature = base64UrlToBytes(encodedSignature);
	const valid = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, signature, signed).catch(() => false);
	if (!valid) return { ok: false, errorCode: 'ID_TOKEN_SIGNATURE_INVALID' };
	return { ok: true, claims };
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
	const clientId = providerEnv(env, provider, 'clientIdEnv');
	const secret = clientSecret(env, provider);
	if (!clientId) return { ok: false, errorCode: 'PROVIDER_APPLICATION_MISSING' };

	const params = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri, client_id: clientId, code_verifier: verifier });
	if (secret) params.set('client_secret', secret); // confidential client; PKCE alone would suffice for a public client

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
	const clientId = providerEnv(env, provider, 'clientIdEnv');
	const secret = clientSecret(env, provider);
	if (!clientId) return { ok: false, errorCode: 'PROVIDER_APPLICATION_MISSING' };

	const params = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: clientId });
	if (secret) params.set('client_secret', secret);

	let response;
	try {
		response = await fetchImpl(tokenEndpointFor(provider, tenantHint), { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: params.toString() });
	} catch (error) {
		return { ok: false, errorCode: 'network_error', errorDescription: String(error?.message || error).slice(0, 200) };
	}
	return parseTokenResponse(response);
}

export { CLIENT_SECRET_ENV, clientSecret, tokenEndpointFor, decodeIdTokenClaims, verifyIdTokenClaims };
export default { exchangeAuthorizationCode, refreshAccessToken };
