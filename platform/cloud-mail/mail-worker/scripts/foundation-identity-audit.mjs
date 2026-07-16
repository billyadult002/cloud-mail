const base = process.env.BASE || 'https://cloud-mail.fastonegroup.workers.dev';
const fixtures = [
	'bill@fastonegroup.com',
	'admin@fastonegroup.com',
	'aki@fastonegroup.com',
	'alistair@fastonegroup.com',
	'Alistair@fastonegroup.com'
];
const forbidden = [
	'email address doesn\'t exist',
	'sqlite_error',
	'd1_error',
	'no such table',
	'session expired'
];

async function request(path, options = {}) {
	const response = await fetch(`${base}/api${path}`, {
		...options,
		headers: { 'content-type': 'application/json', ...(options.headers || {}) }
	});
	return response.json();
}

const results = [];
for (const email of fixtures) {
	const discovery = await request(`/auth/email-discovery?email=${encodeURIComponent(email)}`);
	const login = await request('/login', {
		method: 'POST',
		body: JSON.stringify({
			email,
			password: 'CloudMail-invalid-identity-audit'
		})
	});
	const serialized = JSON.stringify({ discovery, login }).toLowerCase();
	const violation = forbidden.find(value => serialized.includes(value)) || null;
	if (violation) throw new Error(`${email} exposed forbidden error: ${violation}`);
	if (discovery.code !== 200 || !discovery.data?.existsInEmailIdentities) {
		throw new Error(`${email} identity discovery failed: ${JSON.stringify(discovery)}`);
	}
	results.push({
		email,
		normalizedStatus: discovery.data.accountStatus,
		existsInCloudflareRouting: discovery.data.existsInCloudflareRouting,
		routingRuleEnabled: discovery.data.routingRuleEnabled,
		forwardingPreserved: discovery.data.forwardingPreserved,
		loginResponse: login.message
	});
}

const lower = results.find(item => item.email === 'alistair@fastonegroup.com');
const mixed = results.find(item => item.email === 'Alistair@fastonegroup.com');
if (lower?.normalizedStatus !== mixed?.normalizedStatus) {
	throw new Error('Case-insensitive Alistair discovery mismatch');
}

console.log(JSON.stringify({
	fixtures: results,
	forbiddenErrorsObserved: false,
	caseInsensitiveAlistair: true
}, null, 2));
