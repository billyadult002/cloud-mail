import { readFileSync } from 'node:fs';

const service = readFileSync(new URL('../src/service/email-service.js', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const requiredSnippets = [
	'function normalizeRecipientList',
	'receiveEmail = normalizeRecipientList(receiveEmail)',
	'cc = normalizeRecipientList(cc)',
	'bcc = normalizeRecipientList(bcc)',
	'At least one valid recipient is required.',
	'emailData.cc = JSON.stringify',
	'emailData.bcc = JSON.stringify'
];

for (const snippet of requiredSnippets) {
	if (!service.includes(snippet)) {
		throw new Error(`send contract check failed: missing ${snippet}`);
	}
}

const testScript = pkg.scripts?.test || '';
if (/\bdeploy\b/.test(testScript) || /wrangler-test\.toml/.test(testScript)) {
	throw new Error('npm test must not deploy or reference wrangler-test.toml');
}

console.log('send contract check passed');
