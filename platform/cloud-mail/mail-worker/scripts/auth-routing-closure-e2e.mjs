const base = process.env.BASE || 'https://cloud-mail.fastonegroup.workers.dev';
const code = process.env.REGISTRATION_CODE;
if (!code) throw new Error('REGISTRATION_CODE is required');

const stamp = Date.now();
const email = `cloudmail.auth.closure.${stamp}@fastonegroup.com`;
const firstPassword = `CloudMail#First-${stamp}`;
const secondPassword = `CloudMail#Second-${stamp}`;

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

const registered = await api('/register', {
	method: 'POST',
	body: JSON.stringify({ email, password: firstPassword, code, token: '' })
});
if (!registered.data?.userCreated) throw new Error('Registration did not confirm user creation');

const firstLogin = await api('/login', {
	method: 'POST',
	body: JSON.stringify({ email, password: firstPassword })
});
const firstToken = firstLogin.data.token;
const firstHeaders = { authorization: firstToken };
await api('/my/loginUserInfo', { headers: firstHeaders });

await api('/logout', { method: 'DELETE', headers: firstHeaders });
await api('/my/loginUserInfo', { headers: firstHeaders }, 401);

const secondLogin = await api('/login', {
	method: 'POST',
	body: JSON.stringify({ email, password: firstPassword })
});
const secondToken = secondLogin.data.token;
await api('/my/loginUserInfo', { headers: { authorization: secondToken } });

const forgot = await api('/forgot-password', {
	method: 'POST',
	body: JSON.stringify({ email })
});
if (!forgot.data?.resetToken || !forgot.data?.resetLink) {
	throw new Error('Forgot Password did not produce a reset token and link');
}
const resetURL = new URL(forgot.data.resetLink);
if (resetURL.searchParams.get('token') !== forgot.data.resetToken) {
	throw new Error('Reset link token does not match the issued token');
}
const universalLink = await fetch(forgot.data.resetLink, { redirect: 'manual' });
const universalHTML = await universalLink.text();
if (!universalLink.ok || !universalHTML.includes(`token=${forgot.data.resetToken}`)) {
	throw new Error('Universal Link page did not preserve the reset token');
}

await api('/reset-password', {
	method: 'POST',
	body: JSON.stringify({ token: forgot.data.resetToken, newPassword: secondPassword })
});
await api('/login', {
	method: 'POST',
	body: JSON.stringify({ email, password: firstPassword })
}, 501);
const finalLogin = await api('/login', {
	method: 'POST',
	body: JSON.stringify({ email, password: secondPassword })
});

const discovery = await api(`/auth/email-discovery?email=${encodeURIComponent(email)}`);
if (discovery.data.accountStatus !== 'active') {
	throw new Error(`Expected active identity, got ${discovery.data.accountStatus}`);
}

console.log(JSON.stringify({
	email,
	register: true,
	registerReturnedSuccessContract: registered.code === 200,
	routingCreated: registered.data.routingCreated === true,
	routingAction: registered.data.routingSetup?.action || null,
	login: Boolean(firstToken),
	logoutInvalidatedSession: true,
	loginAgain: Boolean(secondToken),
	forgotPassword: true,
	resetPassword: true,
	oldPasswordRejected: true,
	newPasswordLogin: Boolean(finalLogin.data.token),
	universalLinkTokenPreserved: true,
	identityStatus: discovery.data.accountStatus
}, null, 2));
