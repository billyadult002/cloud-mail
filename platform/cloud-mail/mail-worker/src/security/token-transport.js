import constant from '../const/constant';

// Token transport helper (P0 amplifier / WF-2, Phase C).
// Dual-read: accept the session JWT from either the Authorization header
// (legacy localStorage path) OR an httpOnly `cm_token` cookie (hardened path).
// This lets the client migrate off JS-readable storage without a flag day.

function parseCookies(header) {
	const jar = {};
	if (!header) return jar;
	for (const part of header.split(';')) {
		const idx = part.indexOf('=');
		if (idx === -1) continue;
		const key = part.slice(0, idx).trim();
		const value = part.slice(idx + 1).trim();
		if (key) jar[key] = decodeURIComponent(value);
	}
	return jar;
}

// Return the raw JWT string from header first, then cookie.
export function readAuthToken(c) {
	const header = c.req.header(constant.TOKEN_HEADER);
	if (header) return header;
	const cookies = parseCookies(c.req.header('cookie'));
	return cookies[constant.TOKEN_COOKIE] || undefined;
}

export function authTransport(c) {
	const header = c.req.header(constant.TOKEN_HEADER);
	if (header) return 'authorization_header';
	const cookies = parseCookies(c.req.header('cookie'));
	return cookies[constant.TOKEN_COOKIE] ? 'cookie' : 'none';
}

// Set-Cookie value that issues the hardened session cookie.
export function buildAuthCookie(jwt) {
	return [
		`${constant.TOKEN_COOKIE}=${encodeURIComponent(jwt)}`,
		'Path=/',
		'HttpOnly',
		'Secure',
		'SameSite=Strict',
		`Max-Age=${constant.TOKEN_EXPIRE}`
	].join('; ');
}

// Set-Cookie value that clears the session cookie on logout.
export function buildClearAuthCookie() {
	return [
		`${constant.TOKEN_COOKIE}=`,
		'Path=/',
		'HttpOnly',
		'Secure',
		'SameSite=Strict',
		'Max-Age=0'
	].join('; ');
}

export default { readAuthToken, authTransport, buildAuthCookie, buildClearAuthCookie };
