#!/usr/bin/env node
import assert from 'node:assert/strict';

const BASE_URL = (process.env.CLOUDMAIL_SMOKE_BASE_URL || process.env.BASE_URL || '').replace(/\/+$/, '');
const EMAIL = process.env.CLOUDMAIL_SMOKE_EMAIL || '';
const PASSWORD = process.env.CLOUDMAIL_SMOKE_PASSWORD || '';
const ALLOW_PRODUCTION = ['1', 'true', 'yes'].includes(String(process.env.CLOUDMAIL_SMOKE_ALLOW_PRODUCTION || '').toLowerCase());

function redacted(value) {
	return String(value || '').replace(/(cm_token=)[^;]+/gi, '$1[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]');
}

async function request(path, options = {}) {
	const response = await fetch(`${BASE_URL}${path}`, {
		redirect: 'manual',
		...options,
		headers: {
			'content-type': 'application/json',
			...(options.headers || {})
		}
	});
	const text = await response.text();
	let body = null;
	try { body = text ? JSON.parse(text) : null; } catch { body = text; }
	return { response, body, setCookie: response.headers.get('set-cookie') || '' };
}

function assertNonProduction() {
	if (!BASE_URL) {
		console.log('SESSION_OAUTH_SMOKE: SKIP missing CLOUDMAIL_SMOKE_BASE_URL');
		process.exit(0);
	}
	if (/cloud-mail\.fastonegroup\.workers\.dev/i.test(BASE_URL) && !ALLOW_PRODUCTION) {
		throw new Error('Refusing production smoke without CLOUDMAIL_SMOKE_ALLOW_PRODUCTION=true');
	}
	if (!EMAIL || !PASSWORD) {
		console.log('SESSION_OAUTH_SMOKE: SKIP missing non-production credentials');
		process.exit(0);
	}
}

async function main() {
	assertNonProduction();
	const before = await request('/api/session/status');
	assert.notEqual(before.body?.code, 200, 'unauthenticated session should not return authenticated success');

	const login = await request('/api/login', {
		method: 'POST',
		body: JSON.stringify({ email: EMAIL, password: PASSWORD })
	});
	assert.equal(login.response.status, 200, `login failed: ${redacted(JSON.stringify(login.body))}`);
	assert.match(login.setCookie, /cm_token=/i, 'login did not set cm_token');
	assert.match(login.setCookie, /HttpOnly/i, 'cm_token missing HttpOnly');
	assert.match(login.setCookie, /Secure/i, 'cm_token missing Secure');
	assert.match(login.setCookie, /SameSite=Strict/i, 'cm_token missing SameSite=Strict');

	const cookie = login.setCookie.split(';')[0];
	const status = await request('/api/session/status', { headers: { cookie } });
	assert.equal(status.response.status, 200, `cookie session failed: ${redacted(JSON.stringify(status.body))}`);
	assert.equal(status.body?.data?.authenticated, true);
	assert.equal(status.body?.data?.transport, 'cookie');

	const logout = await request('/api/logout', { method: 'DELETE', headers: { cookie } });
	assert.equal(logout.response.status, 200, `logout failed: ${redacted(JSON.stringify(logout.body))}`);
	assert.match(logout.setCookie, /Max-Age=0/i, 'logout did not clear cm_token');

	console.log('SESSION_OAUTH_SMOKE: PASS');
}

main().catch(error => {
	console.error(`SESSION_OAUTH_SMOKE: FAIL ${redacted(error?.message || error)}`);
	process.exit(1);
});
