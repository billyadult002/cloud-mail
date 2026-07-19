import { describe, expect, it } from 'vitest';
import jwtUtils from '../../src/utils/jwt-utils.js';

describe('jwt-utils verifyToken missing token guard', () => {
	it('returns null instead of throwing when token is undefined', async () => {
		const c = { env: { jwt_secret: 'secret' } };
		await expect(jwtUtils.verifyToken(c, undefined)).resolves.toBeNull();
	});

	it('returns null instead of throwing when token is an empty string', async () => {
		const c = { env: { jwt_secret: 'secret' } };
		await expect(jwtUtils.verifyToken(c, '')).resolves.toBeNull();
	});
});
