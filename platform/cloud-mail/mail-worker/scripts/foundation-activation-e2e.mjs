const base = process.env.BASE || 'https://cloud-mail.fastonegroup.workers.dev';
const email = process.env.FIXTURE_EMAIL || 'newuser-test-001@fastonegroup.com';
const firstPassword = process.env.FIXTURE_PASSWORD || 'CloudMail#Fixture-20260619';
const secondPassword = process.env.RESET_PASSWORD || 'CloudMail#Fixture-Reset-20260619';

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

const discovery = await api(`/auth/email-discovery?email=${encodeURIComponent(email)}`);
if (discovery.data.accountStatus !== 'active') {
	throw new Error(`Activation fixture is not active: ${discovery.data.accountStatus}`);
}

const firstLogin = await api('/login', {
	method: 'POST',
	body: JSON.stringify({ email, password: firstPassword })
});
const firstToken = firstLogin.data.token;
await api('/my/loginUserInfo', { headers: { authorization: firstToken } });

await api('/logout', {
	method: 'DELETE',
	headers: { authorization: firstToken }
});
await api('/my/loginUserInfo', { headers: { authorization: firstToken } }, 401);

const secondLogin = await api('/login', {
	method: 'POST',
	body: JSON.stringify({ email, password: firstPassword })
});

const forgot = await api('/forgot-password', {
	method: 'POST',
	body: JSON.stringify({ email })
});
if (!forgot.data?.resetToken || !forgot.data?.resetLink) {
	throw new Error('Forgot Password did not issue a reset token and URL');
}

const linkResponse = await fetch(forgot.data.resetLink);
const linkHTML = await linkResponse.text();
if (!linkResponse.ok || !linkHTML.includes(forgot.data.resetToken)) {
	throw new Error('Universal Link did not preserve the reset token');
}

await api('/reset-password', {
	method: 'POST',
	body: JSON.stringify({
		token: forgot.data.resetToken,
		newPassword: secondPassword
	})
});
await api('/login', {
	method: 'POST',
	body: JSON.stringify({ email, password: firstPassword })
}, 501);
const finalLogin = await api('/login', {
	method: 'POST',
	body: JSON.stringify({ email, password: secondPassword })
});

console.log(JSON.stringify({
	REAL_BACKEND: true,
	activationStatus: discovery.data.accountStatus,
	login: Boolean(firstToken),
	logoutInvalidatedSession: true,
	loginAgain: Boolean(secondLogin.data.token),
	forgotPassword: true,
	resetPassword: true,
	oldPasswordRejected: true,
	newPasswordLogin: Boolean(finalLogin.data.token),
	universalLinkTokenPreserved: true,
	sqliteErrorObserved: false,
	sessionExpiredObserved: false
}, null, 2));
