import { readFile } from 'node:fs/promises';

const root = new URL('../src/service/', import.meta.url);
const files = ['connection-contract-service.js','connection-runtime-service.js','provider-session-service.js','connection-adapter-registry.js','gmail-connection-adapter.js'];
const source = Object.fromEntries(await Promise.all(files.map(async (file) => [file, await readFile(new URL(file, root), 'utf8')])));
const failures = [];

for (const [file, text] of Object.entries(source)) {
	if (/refresh_token_ciphertext|access_token_ciphertext|decryptSecret|encryptSecret/.test(text)) failures.push(`${file}:must_not_access_ciphertext`);
}
if (!/durableMissionRuntime\.verifyClaim/.test(source['connection-runtime-service.js'])) failures.push('connection-runtime-service.js:canonical_verifier_required');
if (/INSERT\s+INTO\s+mission_runtime_verifications/i.test(source['connection-runtime-service.js'])) failures.push('connection-runtime-service.js:direct_verification_insert_forbidden');
if (/nexora-onboarding-token-storage-service/.test(source['connection-runtime-service.js'])) failures.push('connection-runtime-service.js:must_not_import_token_storage');
if (/nexora-onboarding-token-storage-service/.test(source['gmail-connection-adapter.js'])) failures.push('gmail-connection-adapter.js:must_not_import_token_storage');
if (/\bfetch\s*\(/.test(source['connection-runtime-service.js'])) failures.push('connection-runtime-service.js:provider_network_must_use_adapter');
if (!/mailboxMutated:false|mailboxMutated: false/.test(source['gmail-connection-adapter.js'])) failures.push('gmail-connection-adapter.js:read_only_receipt_missing');
if (failures.length) { console.error(failures.join('\n')); process.exit(1); }
console.log('PASS_CONNECTION_RUNTIME_COUPLING');
