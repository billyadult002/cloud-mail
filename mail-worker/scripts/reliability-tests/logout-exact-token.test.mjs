import { describe, expect, it } from 'vitest';
import { removeExactAuthToken } from '../../src/service/auth-token-set-service.mjs';
import loginService from '../../src/service/login-service.js';
import JwtUtils from '../../src/utils/jwt-utils.js';

const JWT_SECRET = 'test-only-logout-jwt-secret';

async function logoutContext(tokens, payloadToken = 'current-session') {
	const jwt = await JwtUtils.generateToken({ env: { jwt_secret: JWT_SECRET } }, { userId: 17, token: payloadToken });
	const writes = [];
	const authInfo = { user: { userId: 17 }, tokens: [...tokens] };
	return {
		c: {
			env: {
				jwt_secret: JWT_SECRET,
				kv: {
					async get() { return authInfo; },
					async put(key, value) { writes.push({ key, value: JSON.parse(value) }); }
				}
			},
			req: { header(name) { return name === 'Authorization' ? jwt : null; } }
		},
		writes
	};
}

describe('logout exact-token revocation', () => {
	it('removes only the token carried by the authenticated JWT', async () => {
		const authInfo = { tokens: ['older-session', 'current-session', 'newer-session'] };

		expect(removeExactAuthToken(authInfo, 'current-session')).toBe(true);
		expect(authInfo.tokens).toEqual(['older-session', 'newer-session']);
	});

	it('does not revoke another session when the JWT token is absent', async () => {
		const authInfo = { tokens: ['older-session', 'newer-session'] };

		expect(removeExactAuthToken(authInfo, 'missing-session')).toBe(false);
		expect(authInfo.tokens).toEqual(['older-session', 'newer-session']);
	});

	it('is mutation-free when auth state is already absent', async () => {
		expect(removeExactAuthToken(null, 'current-session')).toBe(false);
	});

	it('decodes and awaits the JWT before revoking the exact KV token', async () => {
		const { c, writes } = await logoutContext(['older-session', 'current-session', 'newer-session']);

		await loginService.logout(c, 17);

		expect(writes).toHaveLength(1);
		expect(writes[0].value.tokens).toEqual(['older-session', 'newer-session']);
	});
});
