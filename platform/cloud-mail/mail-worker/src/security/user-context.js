import JwtUtils from '../utils/jwt-utils';
import { readAuthToken } from './token-transport';

const userContext = {
	getUserId(c) {
		return c.get('user').userId;
	},

	getUser(c) {
		return c.get('user');
	},

	async getToken(c) {
		// Dual-read: Authorization header (legacy) or httpOnly cookie (hardened).
		const jwt = readAuthToken(c);
		const result = await JwtUtils.verifyToken(c,jwt);
		return result?.token;
	},
};
export default userContext;
