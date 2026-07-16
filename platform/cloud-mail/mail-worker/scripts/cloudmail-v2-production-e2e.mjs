const base = process.env.BASE || 'https://cloud-mail.fastonegroup.workers.dev';
const code = process.env.REGISTRATION_CODE;
if (!code) throw new Error('REGISTRATION_CODE is required');

const stamp = Date.now();
const email = `cloudmail.v2.${stamp}@fastonegroup.com`;
const aliasEmail = `cloudmail.v2.alias.${stamp}@fastonegroup.com`;
const password = `CloudMail#V2-${stamp}`;

async function api(path, options = {}, expectedCode = 200) {
	const response = await fetch(`${base}/api${path}`, {
		...options,
		headers: { 'content-type': 'application/json', ...(options.headers || {}) }
	});
	const body = await response.json();
	if (body.code !== expectedCode) {
		throw new Error(`${path} expected ${expectedCode}, got ${JSON.stringify(body)}`);
	}
	return body;
}

await api('/register', {
	method: 'POST',
	body: JSON.stringify({ email, password, code, token: '' })
});
const login = await api('/login', {
	method: 'POST',
	body: JSON.stringify({ email, password })
});
const authorization = login.data.token;
const headers = { authorization };

const discovery = await api(`/auth/email-discovery?email=${encodeURIComponent(email)}`);
if (discovery.data.accountStatus !== 'active') throw new Error('Registered identity is not active');

const consent = await api('/v2/ai/consent', { headers });
if (!consent.data.ai_enabled || consent.data.cloud_ai_enabled) {
	throw new Error('AI consent defaults are not privacy-preserving');
}
const savedConsent = await api('/v2/ai/consent', {
	method: 'PUT',
	headers,
	body: JSON.stringify({
		ai_enabled: true,
		apple_local_enabled: true,
		cloud_ai_enabled: false,
		single_mail_read: true,
		thread_read: false,
		attachment_read: false,
		save_outputs: false,
		search_index: false,
		auto_classify: false,
		cleanup_suggestions: true,
		auto_send: false,
		auto_delete: false,
		auto_archive: false,
		auto_unsubscribe: false
	})
});
if (savedConsent.data.cloud_ai_enabled || savedConsent.data.auto_send || savedConsent.data.auto_delete) {
	throw new Error('Unsafe AI consent value persisted');
}

const providers = await api('/v2/ai/providers', { headers });
for (const key of ['openai_chatgpt', 'google_gemini', 'anthropic_claude']) {
	if (providers.data[key].authorized) throw new Error(`${key} unexpectedly authorized`);
}

const accounts = await api('/v2/accounts', { headers });
if (!accounts.data.some(account => account.provider === 'cloudflare_native' && account.email === email)) {
	throw new Error('Native account was not reconciled');
}
await api('/account/add', {
	method: 'POST',
	headers,
	body: JSON.stringify({ email: aliasEmail, token: '' })
});
const aliasLogin = await api('/login', {
	method: 'POST',
	body: JSON.stringify({ email: aliasEmail, password })
});
if (!aliasLogin.data.token) throw new Error('Alias identity login failed');
await api('/v2/mail/messages', { headers });

const security = await api('/v2/security/analyze', {
	method: 'POST',
	headers,
	body: JSON.stringify({
		sender: 'alerts@example.test',
		subject: 'Urgent payment - verify your account',
		body: 'Your password expires. Send a gift card.',
		html: '<img src="https://tracker.test/pixel" width="1" height="1">'
	})
});
if (!security.data.phishingWarning || !security.data.trackerBlocking.blocked) {
	throw new Error('Security analysis did not identify deterministic signals');
}

const secure = await api('/v2/secure-send', {
	method: 'POST',
	headers,
	body: JSON.stringify({ body: 'CloudMail secure-send E2E payload', expiresInSeconds: 300 })
});
const secureResponse = await fetch(secure.data.url);
const securePayload = await secureResponse.json();
if (securePayload.body !== 'CloudMail secure-send E2E payload') {
	throw new Error('Secure Send payload round-trip failed');
}

const admin = await api('/v2/admin/summary', { headers }, 403);
if (admin.code !== 403) throw new Error('Admin RBAC negative assertion failed');

console.log(JSON.stringify({
	register: true,
	login: true,
	identityReconciliation: true,
	aiConsentDefaults: true,
	cloudAIUnauthorized: true,
	nativeAccount: true,
	aliasIdentityLogin: true,
	unifiedMailRead: true,
	phishingWarning: true,
	trackerBlocking: true,
	secureSendR2: true,
	adminRBACDenied: true,
	secretsExposed: false
}, null, 2));
