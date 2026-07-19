// NEXORA Zero-Touch onboarding: real token-exchange HTTP call logic, verified against
// deterministic fixture Response objects (no live network, no real credentials) -- proves the
// request construction (grant_type/code/redirect_uri/client_id/code_verifier/client_secret)
// and response parsing (success, provider error, malformed body, network failure) are correct.
// This is explicitly logic-only verification, same distinction as every other OAuth piece in
// this mission: it cannot prove Google/Microsoft's real endpoints behave this way, only that
// this code behaves correctly against the documented OAuth 2.0 token-response shape.
import { describe, expect, it, vi } from 'vitest';
import tokenExchange, { clientSecret, tokenEndpointFor, verifyIdTokenClaims } from '../../src/service/nexora-onboarding-token-exchange-service.js';

function fixtureResponse({ ok = true, status = 200, json }) {
	return { ok, status, json: async () => json };
}

async function signedJwtFixture(claims, { kid = 'fixture-kid', clientId = 'client-id-fixture', issuer = 'https://accounts.google.com' } = {}) {
	const keys = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
	const encodeBytes = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
	const encodeJson = obj => encodeBytes(new TextEncoder().encode(JSON.stringify(obj)));
	const header = encodeJson({ alg: 'RS256', typ: 'JWT', kid });
	const payload = encodeJson({ iss: issuer, aud: clientId, exp: Math.floor(Date.now() / 1000) + 3600, ...claims });
	const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', keys.privateKey, new TextEncoder().encode(`${header}.${payload}`));
	const publicJwk = await crypto.subtle.exportKey('jwk', keys.publicKey);
	return {
		idToken: `${header}.${payload}.${encodeBytes(signature)}`,
		jwksFetch: async () => ({ ok: true, status: 200, json: async () => ({ keys: [{ ...publicJwk, kid, alg: 'RS256', use: 'sig' }] }) }),
	};
}

describe('Token endpoint construction', () => {
	it('resolves the Microsoft tenant-scoped endpoint and the Google fixed endpoint', () => {
		expect(tokenEndpointFor('google', null)).toBe('https://oauth2.googleapis.com/token');
		expect(tokenEndpointFor('microsoft', 'contoso-tenant')).toBe('https://login.microsoftonline.com/contoso-tenant/oauth2/v2.0/token');
		expect(tokenEndpointFor('microsoft', null)).toContain('/common/');
	});
});

describe('exchangeAuthorizationCode — request construction and response parsing', () => {
	it('PROVIDER_APPLICATION_MISSING is returned honestly when no client_id is configured, no network call attempted', async () => {
		const fetchImpl = vi.fn();
		const result = await tokenExchange.exchangeAuthorizationCode({}, { provider: 'google', code: 'auth-code', verifier: 'verifier', redirectUri: 'https://x/callback' }, fetchImpl);
		expect(result.ok).toBe(false);
		expect(result.errorCode).toBe('PROVIDER_APPLICATION_MISSING');
		expect(fetchImpl).not.toHaveBeenCalled();
	});

	it('constructs a correct application/x-www-form-urlencoded request with PKCE verifier and client_secret for a confidential client', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(fixtureResponse({ json: { access_token: 'fixture-access-token', refresh_token: 'fixture-refresh-token', expires_in: 3600, scope: 'openid email https://www.googleapis.com/auth/gmail.readonly' } }));
		const env = { NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'client-id-fixture', NEXORA_GOOGLE_OAUTH_CLIENT_SECRET: 'client-secret-fixture' };
		const result = await tokenExchange.exchangeAuthorizationCode(env, { provider: 'google', code: 'auth-code-fixture', verifier: 'verifier-fixture', redirectUri: 'https://nexora.example/callback/google' }, fetchImpl);

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('https://oauth2.googleapis.com/token');
		expect(init.method).toBe('POST');
		const body = new URLSearchParams(init.body);
		expect(body.get('grant_type')).toBe('authorization_code');
		expect(body.get('code')).toBe('auth-code-fixture');
		expect(body.get('code_verifier')).toBe('verifier-fixture');
		expect(body.get('client_id')).toBe('client-id-fixture');
		expect(body.get('client_secret')).toBe('client-secret-fixture');
		expect(body.get('redirect_uri')).toBe('https://nexora.example/callback/google');

		expect(result.ok).toBe(true);
		expect(result.accessToken).toBe('fixture-access-token');
		expect(result.refreshToken).toBe('fixture-refresh-token');
		expect(result.grantedScopes).toEqual(['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly']);
	});

	it('uses legacy Google OAuth secret names as cutover aliases while canonical NEXORA names take precedence', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(fixtureResponse({ json: { access_token: 'fixture-access-token', expires_in: 3600 } }));
		const legacyEnv = {
			GOOGLE_OAUTH_CLIENT_ID: 'legacy-client-id',
			GOOGLE_OAUTH_CLIENT_SECRET: 'legacy-client-secret',
		};
		expect(clientSecret(legacyEnv, 'google')).toBe('legacy-client-secret');
		expect(clientSecret({ ...legacyEnv, NEXORA_GOOGLE_OAUTH_CLIENT_SECRET: 'canonical-client-secret' }, 'google')).toBe('canonical-client-secret');

		const result = await tokenExchange.exchangeAuthorizationCode(legacyEnv, { provider: 'google', code: 'auth-code-fixture', verifier: 'verifier-fixture', redirectUri: 'https://cloud-mail.fastonegroup.workers.dev/v3/onboarding/providers/google/callback' }, fetchImpl);
		expect(result.ok).toBe(true);
		const body = new URLSearchParams(fetchImpl.mock.calls[0][1].body);
		expect(body.get('client_id')).toBe('legacy-client-id');
		expect(body.get('client_secret')).toBe('legacy-client-secret');
		expect(JSON.stringify(result)).not.toContain('legacy-client-secret');
	});

	it('a provider error response (e.g. invalid_grant for a reused/expired code) is classified, not thrown', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(fixtureResponse({ ok: false, status: 400, json: { error: 'invalid_grant', error_description: 'Code was already redeemed.' } }));
		const env = { NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'client-id-fixture' };
		const result = await tokenExchange.exchangeAuthorizationCode(env, { provider: 'google', code: 'reused-code', verifier: 'v', redirectUri: 'https://x/callback' }, fetchImpl);
		expect(result.ok).toBe(false);
		expect(result.errorCode).toBe('invalid_grant');
		expect(result.httpStatus).toBe(400);
	});

	it('a malformed (non-JSON) response body is handled without throwing', async () => {
		const fetchImpl = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new Error('not json'); } });
		const env = { NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'client-id-fixture' };
		const result = await tokenExchange.exchangeAuthorizationCode(env, { provider: 'google', code: 'c', verifier: 'v', redirectUri: 'https://x/callback' }, fetchImpl);
		expect(result.ok).toBe(false);
		expect(result.errorCode).toBe('invalid_response');
	});

	it('V19: a network-level failure (fetch rejects, e.g. provider outage) is classified as network_error, not an uncaught exception', async () => {
		const fetchImpl = vi.fn().mockRejectedValue(new Error('fetch failed: connection reset'));
		const env = { NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'client-id-fixture' };
		const result = await tokenExchange.exchangeAuthorizationCode(env, { provider: 'google', code: 'c', verifier: 'v', redirectUri: 'https://x/callback' }, fetchImpl);
		expect(result.ok).toBe(false);
		expect(result.errorCode).toBe('network_error');
	});

	it('never surfaces the raw client_secret or code_verifier in the returned result object', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(fixtureResponse({ json: { access_token: 'at', expires_in: 3600 } }));
		const env = { NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'cid', NEXORA_GOOGLE_OAUTH_CLIENT_SECRET: 'super-secret-value' };
		const result = await tokenExchange.exchangeAuthorizationCode(env, { provider: 'google', code: 'c', verifier: 'verifier-should-not-leak', redirectUri: 'https://x/callback' }, fetchImpl);
		expect(JSON.stringify(result)).not.toContain('super-secret-value');
		expect(JSON.stringify(result)).not.toContain('verifier-should-not-leak');
	});
});

describe('verifyIdTokenClaims', () => {
	it('verifies RS256 signature, issuer, audience, expiry, and nonce before exposing claims', async () => {
		const { idToken, jwksFetch } = await signedJwtFixture({ sub: 'sub-1', email: 'user@example.com', nonce: 'nonce-1' });
		const nonceHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('nonce-1')).then(bytes => [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join(''));
		const result = await verifyIdTokenClaims({ NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'client-id-fixture' }, { provider: 'google', idToken, expectedNonceHash: nonceHash }, jwksFetch);
		expect(result.ok).toBe(true);
		expect(result.claims.email).toBe('user@example.com');
	});

	it('rejects an audience mismatch before identity claims can be trusted', async () => {
		const { idToken, jwksFetch } = await signedJwtFixture({ sub: 'sub-1', email: 'user@example.com' });
		const result = await verifyIdTokenClaims({ NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'different-client' }, { provider: 'google', idToken }, jwksFetch);
		expect(result.ok).toBe(false);
		expect(result.errorCode).toBe('ID_TOKEN_AUDIENCE_INVALID');
	});
});

describe('refreshAccessToken', () => {
	it('constructs a refresh_token grant request and parses a successful response', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(fixtureResponse({ json: { access_token: 'new-access-token', expires_in: 3600, scope: 'Mail.Read' } }));
		const env = { NEXORA_MICROSOFT_OAUTH_CLIENT_ID: 'ms-client-id' };
		const result = await tokenExchange.refreshAccessToken(env, { provider: 'microsoft', refreshToken: 'old-refresh-token-fixture', tenantHint: 'contoso' }, fetchImpl);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe('https://login.microsoftonline.com/contoso/oauth2/v2.0/token');
		const body = new URLSearchParams(init.body);
		expect(body.get('grant_type')).toBe('refresh_token');
		expect(body.get('refresh_token')).toBe('old-refresh-token-fixture');
		expect(result.ok).toBe(true);
		expect(result.accessToken).toBe('new-access-token');
	});

	it('V12: a revoked refresh token (invalid_grant) is classified, matching the token-lifecycle-service revocation classifier', async () => {
		const fetchImpl = vi.fn().mockResolvedValue(fixtureResponse({ ok: false, status: 400, json: { error: 'invalid_grant', error_description: 'Token has been expired or revoked.' } }));
		const env = { NEXORA_GOOGLE_OAUTH_CLIENT_ID: 'cid' };
		const result = await tokenExchange.refreshAccessToken(env, { provider: 'google', refreshToken: 'revoked-token' }, fetchImpl);
		expect(result.ok).toBe(false);
		expect(result.errorCode).toBe('invalid_grant');
	});
});
