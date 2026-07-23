import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const failures = [];
const requireMatch = (condition, message) => { if (!condition) failures.push(message); };

const migration = read('migrations/0084_nexora_oauth_confidential_exchange_recovery.sql');
const api = read('src/api/nexora-onboarding-api.js');
const orchestrator = read('src/service/nexora-onboarding-orchestrator-service.js');
const receipt = read('src/service/nexora-oauth-exchange-receipt-service.js');
const intake = read('src/service/nexora-oauth-callback-intake-service.js');
const scopeManifest = read('src/service/nexora-oauth-scope-manifest-service.js');
const security = read('src/security/security.js');
const workerEntry = read('src/index.js');
const wrangler = read('wrangler.toml');

const schemaWithoutComments = migration
	.replace(/--.*$/gm, '')
	.replace(/\/\*[\s\S]*?\*\//g, '');
for (const prohibitedColumn of [
	/\bauthorization_code\b/i,
	/\bcallback_query\b/i,
	/\bpkce_verifier\b/i,
	/\baccess_token\b/i,
	/\brefresh_token\b/i,
	/\bclient_secret\b/i,
]) requireMatch(!prohibitedColumn.test(schemaWithoutComments), `prohibited OAuth plaintext column pattern: ${prohibitedColumn}`);

const callbackStart = api.indexOf('async function handleProviderCallback');
const callbackEnd = api.indexOf("app.get('/v3/onboarding/providers/google/callback'");
const callbackBlock = api.slice(callbackStart, callbackEnd);
requireMatch(callbackStart >= 0 && callbackEnd > callbackStart, 'provider callback block not found');
requireMatch(!/c\.json\s*\(/.test(callbackBlock), 'provider callback renders JSON');
requireMatch(/finally\s*\{[\s\S]*Max-Age=0/.test(callbackBlock), 'provider callback does not clear PKCE cookie in finally');
requireMatch(/c\.redirect\([^,]+,\s*303\)/.test(callbackBlock), 'provider callback does not use a 303 clean redirect');
requireMatch(!/onboardingOrchestrator\.handleCallback/.test(callbackBlock), 'provider callback retains synchronous provider/exchange path');
requireMatch(/Referrer-Policy',\s*'no-referrer'/.test(api), 'no-referrer policy missing');
requireMatch(/default-src 'none'/.test(api), 'restrictive callback CSP missing');
requireMatch(!/[?&#](?:code|state|error|token)=/i.test(callbackBlock), 'clean redirect embeds OAuth parameters');

for (const [name, source] of [['callback API', api], ['orchestrator', orchestrator], ['callback intake', intake], ['exchange receipt', receipt]]) {
	requireMatch(!/\bconsole\.(?:log|info|warn|error|debug)\s*\(/.test(source), `${name} contains normal console logging`);
}

requireMatch(/encryptSecret\([\s\S]*purpose:\s*'provider-token'[\s\S]*aad:/.test(receipt), 'exchange receipt is not AES-GCM/AAD-bound');
requireMatch(/receipt_ciphertext=CASE WHEN \?2 IN \('CALLBACK_VERIFIED','REAUTHORIZATION_REQUIRED'\) THEN NULL/.test(receipt), 'terminal receipt is not tombstoned');
requireMatch(/encryptSecret\([\s\S]*purpose:\s*'provider-token'[\s\S]*aad:/.test(intake), 'callback intake is not AES-GCM/AAD-bound');
requireMatch(/payload_ciphertext=''/.test(intake), 'callback intake is not tombstoned');
requireMatch(/NEXORA_OAUTH_CALLBACK_PROCESS/.test(intake), 'durable callback processing job is missing');
requireMatch(/callbackIntake\.processPending/.test(workerEntry), 'scheduled callback intake consumer is missing');
requireMatch(/NEXORA_OAUTH_AUTHORIZATION_CREATION_ENABLED[\s\S]*OAUTH_AUTHORIZATION_CREATION_DISABLED/.test(api), 'default-off OAuth authorization creation gate is missing');
requireMatch(/\[observability\][\s\S]*enabled\s*=\s*false/.test(wrangler), 'Worker observability must be disabled for callback-query confidentiality');
requireMatch(!/\[(?:env\.[^.]+\.)?observability\][\s\S]*?enabled\s*=\s*true/.test(wrangler), 'an environment still enables Worker invocation observability');
requireMatch(/gmail\.readonly/.test(scopeManifest), 'read-only Gmail scope missing');
requireMatch(/gmail\.send[\s\S]*productionStatus:\s*'not_approved'/.test(scopeManifest), 'send scope is not blocked');
requireMatch(/https:\/\/mail\.google\.com\/[\s\S]*productionStatus:\s*'prohibited'/.test(scopeManifest), 'full Gmail scope is not prohibited');
requireMatch(security.includes('/v3/onboarding/providers/google/result'), 'clean Google result route is not public');
requireMatch(security.includes('/v3/onboarding/providers/microsoft/result'), 'clean Microsoft result route is not public');

const cloudMailOAuthBoundary = [api, orchestrator, intake, receipt, scopeManifest].join('\n');
for (const connectorMarker of ['codex_apps', 'gmail connector', 'google drive connector', 'google calendar connector', 'app://']) {
	requireMatch(!cloudMailOAuthBoundary.toLowerCase().includes(connectorMarker), `Codex connector marker crossed into CloudMail OAuth: ${connectorMarker}`);
}

if (failures.length) {
	console.error(`OAUTH_SENSITIVE_ARTIFACT_GUARD FAIL\n${failures.map((failure) => `- ${failure}`).join('\n')}`);
	process.exit(1);
}
console.log('PASS_OAUTH_SENSITIVE_ARTIFACT_GUARD');
