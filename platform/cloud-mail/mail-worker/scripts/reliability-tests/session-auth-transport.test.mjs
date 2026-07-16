import { describe, expect, it } from 'vitest';
import {
	authTransport,
	buildAuthCookie,
	buildClearAuthCookie,
	readAuthToken
} from '../../src/security/token-transport.js';

function contextWithHeaders(headers = {}) {
	const normalized = Object.fromEntries(
		Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
	);
	return {
		req: {
			header(name) {
				return normalized[String(name).toLowerCase()];
			}
		}
	};
}

describe('session auth transport', () => {
	it('reads the hardened HttpOnly cookie session when no legacy header is present', () => {
		const c = contextWithHeaders({
			cookie: 'theme=dark; cm_token=cookie-token-123; locale=en'
		});

		expect(readAuthToken(c)).toBe('cookie-token-123');
		expect(authTransport(c)).toBe('cookie');
	});

	it('keeps Authorization header compatibility for legacy clients', () => {
		const c = contextWithHeaders({
			authorization: 'legacy-header-token-123'
		});

		expect(readAuthToken(c)).toBe('legacy-header-token-123');
		expect(authTransport(c)).toBe('authorization_header');
	});

	it('prefers the Authorization header when both transports are present', () => {
		const c = contextWithHeaders({
			authorization: 'legacy-header-token-123',
			cookie: 'cm_token=cookie-token-123'
		});

		expect(readAuthToken(c)).toBe('legacy-header-token-123');
		expect(authTransport(c)).toBe('authorization_header');
	});

	it('builds browser session cookies with HttpOnly, Secure, and SameSite hardening', () => {
		const cookie = buildAuthCookie('jwt.with spaces');

		expect(cookie).toContain('cm_token=jwt.with%20spaces');
		expect(cookie).toContain('Path=/');
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('Secure');
		expect(cookie).toContain('SameSite=Strict');
		expect(cookie).toContain('Max-Age=2592000');
	});

	it('clears the browser session cookie on logout', () => {
		const cookie = buildClearAuthCookie();

		expect(cookie).toContain('cm_token=');
		expect(cookie).toContain('Path=/');
		expect(cookie).toContain('HttpOnly');
		expect(cookie).toContain('Secure');
		expect(cookie).toContain('SameSite=Strict');
		expect(cookie).toContain('Max-Age=0');
	});
});
