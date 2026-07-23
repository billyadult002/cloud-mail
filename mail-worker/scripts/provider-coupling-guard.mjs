import { readFileSync } from 'node:fs';
const genericBoundary = [
	'src/service/capability-invocation-service.js',
	'src/service/capability-authority-context-service.js',
	'src/service/capability-registry-service.js',
	'src/service/capability-verified-action-boundary-service.js',
	'src/service/capability-evidence-ledger-service.js',
	'src/service/capability-verification-service.js',
	'src/service/scheduled-capability-runtime-service.js',
];
const adapterBoundary = ['src/service/gmail-communication-capability-adapter.js'];
const forbidden = [/googleapis\.com/i, /accounts\.google\.com/i, /graph\.microsoft\.com/i, /google-provider-adapter/i, /legacy.*runner/i, /\bfetch\s*\(/, /credential.*service/i, /email-service/i, /gmail-imap-service/i, /gemini-oauth-service/i];
const failures = [];
for (const file of genericBoundary) {
	const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
	for (const pattern of forbidden) if (pattern.test(source)) failures.push(`${file}:${pattern}`);
}
for (const file of adapterBoundary) {
	const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
	for (const pattern of [/googleapis\.com/i, /accounts\.google\.com/i, /\bfetch\s*\(/, /credential.*service/i, /email-service/i, /gmail-imap-service/i, /gemini-oauth-service/i]) if (pattern.test(source)) failures.push(`${file}:${pattern}`);
}
const invocation = readFileSync(new URL('../src/service/capability-invocation-service.js', import.meta.url), 'utf8');
if (/evidence_id\s*:\s*crypto\.randomUUID/.test(invocation)) failures.push('src/service/capability-invocation-service.js:fabricated-evidence-id');
if (/verification_state\s*:\s*['"]verified['"]/.test(invocation)) failures.push('src/service/capability-invocation-service.js:self-verification');
if (!/await\s+mintCapabilityAuthorityContext\s*\(/.test(invocation)) failures.push('src/service/capability-invocation-service.js:production-authority-bypass');
const caller = readFileSync(new URL('../src/service/scheduled-capability-runtime-service.js', import.meta.url), 'utf8');
if (/createCapabilityRegistry|createCapabilityEvidenceWriter|createCapabilityVerifier|gmail-communication-capability-adapter/.test(caller)) failures.push('src/service/scheduled-capability-runtime-service.js:production-dependency-override');
if (failures.length) { console.error('PROVIDER_COUPLING_GUARD FAIL'); console.error(failures.join('\n')); process.exit(1); }
console.log(`PROVIDER_COUPLING_GUARD PASS migrated_files=${genericBoundary.length} adapter_files=${adapterBoundary.length}`);
