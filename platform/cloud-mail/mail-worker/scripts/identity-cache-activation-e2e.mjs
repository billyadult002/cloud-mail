const base = process.env.BASE || 'https://cloud-mail.fastonegroup.workers.dev';
const email = process.env.FIXTURE_EMAIL || 'reconcile-20260620@fastonegroup.com';
const password = process.env.FIXTURE_PASSWORD || 'CloudMail#Reconcile-20260620';
const fixtureActivationToken = process.env.FIXTURE_ACTIVATION_TOKEN;

async function api(path, options = {}, expectedCode = 200) {
	const response = await fetch(`${base}/api${path}`, {
		...options,
		headers: { 'content-type': 'application/json', ...(options.headers || {}) }
	});
	const body = await response.json();
	if (body.code !== expectedCode) {
		throw new Error(`${path} expected ${expectedCode}, got code ${body.code}`);
	}
	return body.data;
}

const before = await api(`/auth/email-discovery?email=${encodeURIComponent(email)}`);
if (!fixtureActivationToken && !['routing_only', 'pending', 'catch_all_eligible'].includes(before.accountStatus)) {
	throw new Error(`Expected activatable identity, got ${before.accountStatus}`);
}

let activationToken = fixtureActivationToken;
if (!activationToken) {
	const bootstrap = await api('/auth/bootstrap-from-routing', {
		method: 'POST',
		body: JSON.stringify({ email })
	});
	activationToken = bootstrap.activationToken;
}
if (!activationToken) {
	throw new Error('No activation token was supplied by the controlled fixture or E2E mode');
}

const activation = await api('/auth/activate', {
	method: 'POST',
	body: JSON.stringify({ token: activationToken, password })
});
if (activation.status !== 'active') {
	throw new Error(`Activation failed with status ${activation.status}`);
}

const login = await api('/login', {
	method: 'POST',
	body: JSON.stringify({ email, password })
});
const token = login.token;
if (!token) throw new Error('Activated identity could not log in');

const after = await api(`/auth/email-discovery?email=${encodeURIComponent(email)}`);
if (after.accountStatus !== 'active') {
	throw new Error(`Activated identity remained ${after.accountStatus}`);
}

const messages = await api('/v2/mail/messages', {
	headers: { authorization: token }
});
const cachedMessageVisible = Array.isArray(messages)
	? messages.some(message => message.subject?.startsWith('CloudMail Reconciliation CATCHALL'))
	: messages?.messages?.some?.(message => message.subject?.startsWith('CloudMail Reconciliation CATCHALL'));

console.log(JSON.stringify({
	REAL_BACKEND: true,
	email,
	beforeStatus: before.accountStatus,
	activationStatus: activation.status,
	login: true,
	afterStatus: after.accountStatus,
	cachedMessageVisible: Boolean(cachedMessageVisible)
}, null, 2));
