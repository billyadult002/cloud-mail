import { readFileSync } from 'node:fs';
const genericBoundary = [
	'src/service/capability-invocation-service.js',
	'src/service/capability-authority-context-service.js',
	'src/service/capability-registry-service.js',
	'src/service/capability-verified-action-boundary-service.js',
	'src/service/scheduled-capability-runtime-service.js',
	'src/service/gmail-communication-capability-adapter.js',
];
const forbidden = [/googleapis\.com/i, /accounts\.google\.com/i, /graph\.microsoft\.com/i, /google-provider-adapter/i, /legacy.*runner/i, /\bfetch\s*\(/, /credential.*service/i];
const failures = [];
for (const file of genericBoundary) {
	const source = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
	for (const pattern of forbidden) if (pattern.test(source)) failures.push(`${file}:${pattern}`);
}
if (failures.length) { console.error('PROVIDER_COUPLING_GUARD FAIL'); console.error(failures.join('\n')); process.exit(1); }
console.log(`PROVIDER_COUPLING_GUARD PASS migrated_files=${genericBoundary.length}`);
