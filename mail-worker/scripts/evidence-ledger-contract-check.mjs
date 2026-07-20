import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
	buildAtomicLedgerStatements,
	canonicalize,
	computeEvidenceIntegrity,
	readEvidenceChain,
	sha256Hex,
	verifyEvidenceChain,
	verifyClassificationEvidence
} from '../src/service/nexora-evidence-ledger-service.mjs';
import { deriveCorrelationRef, deriveSessionRef } from '../src/service/nexora-session-ref-service.mjs';

const migration = readFileSync(new URL('../migrations/0079_nexora_p0_authority_evidence_correlation.sql', import.meta.url), 'utf8');

for (const table of [
	'nexora_classification_runs',
	'nexora_email_classification_events',
	'nexora_email_classification_evidence_v2',
	'nexora_classification_ledger_heads',
	'nexora_domain_ownership_verification_events',
	'nexora_runtime_acceptance_sessions',
	'nexora_runtime_correlation_events'
]) {
	assert.ok(migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`), `${table} must be created`);
}

for (const column of [
	'generation',
	'consumed_at',
	'superseded_at',
	'verification_operation_id',
	'canonical_message_id',
	'canonical_account_id',
	'source_created_at',
	'provenance_ref',
	'current_event_id',
	'current_evidence_id',
	'runtime_deployment_id',
	'auth_session_ref',
	'artifact_digest',
	'source_commit',
	'signing_identity',
	'signing_key_version',
	'allowlist_policy_version',
	'attestation_ref',
	'attestation_digest',
	'acceptance_correlation_ref'
]) {
	assert.ok(migration.includes(column), `${column} must be represented in the P0 schema`);
}

assert.match(migration, /BEFORE UPDATE ON nexora_email_classification_events/);
assert.match(migration, /BEFORE DELETE ON nexora_email_classification_events/);
assert.match(migration, /BEFORE UPDATE ON nexora_email_classification_evidence_v2/);
assert.match(migration, /BEFORE DELETE ON nexora_email_classification_evidence_v2/);
assert.match(migration, /RAISE\(ABORT, 'nexora_evidence_append_only'\)/);
assert.match(migration, /event_id TEXT NOT NULL UNIQUE/);
assert.match(migration, /CHECK\(body_persisted = 0\)/);
assert.match(migration, /nexora_classification_run_scope_mismatch/);
assert.match(migration, /nexora_classification_evidence_linkage_mismatch/);
assert.match(migration, /nexora_domain_verification_linkage_mismatch/);
assert.match(migration, /nexora_runtime_correlation_linkage_mismatch/);
assert.match(migration, /BEFORE UPDATE OF workspace_id ON workspace_domains/);
assert.match(migration, /workspace_domain_owner_immutable/);

assert.equal(canonicalize({ z: 1, a: { y: 2, x: [3, undefined, null] } }), '{"a":{"x":[3,null,null],"y":2},"z":1}');
assert.equal(canonicalize({ b: 2, a: 1 }), canonicalize({ a: 1, b: 2 }));
await assert.rejects(() => sha256Hex(undefined), /digest input is required/);
const digest = await sha256Hex({ b: 2, a: 1 });
assert.match(digest, /^[a-f0-9]{64}$/);
assert.equal(digest, await sha256Hex({ a: 1, b: 2 }));

const prepared = [];
const db = {
	prepare(sql) {
		return {
			bind(...values) {
				const statement = { sql, values };
				prepared.push(statement);
				return statement;
			}
		};
	}
};

const input = {
	run: {
		id: 'run-1', tenantId: 1, workspaceId: 2, domainAuthorityId: 'authority-1', authorityGeneration: 3,
		authorityEvidenceRef: 'authority-evidence-1', actorUserId: 1, authSessionRef: 'session-hmac', hmacKeyVersion: 'test-v1',
		canonicalAccountId: 10, providerAccountHash: 'provider-account-hash', requestId: 'ray-1',
		runtimeDeploymentId: 'deployment-1', acceptanceCorrelationRef: 'acceptance-hmac', clientKind: 'DESKTOP',
		classifierVersion: 'classifier-v1', rulesVersion: 'rules-v1', modelVersion: null,
		inputDigest: 'a'.repeat(64), idempotencyKey: 'run-idempotency-1', startedAt: '2026-07-19T20:00:00.000Z'
	},
	event: {
		id: 'event-1', classificationId: 'classification-1', customerDomain: 'example.com', provider: 'google',
		canonicalMessageId: 'message-1', sourceCreatedAt: '2026-07-19T19:59:00.000Z', provenanceRef: 'provider:message-1',
		messageFingerprint: 'message-fingerprint', generation: 1, previousEventId: null, previousEntryDigest: null,
		primaryCategory: 'BUSINESS', vipRelationship: false, priorityLevel: 'NORMAL', requiresAction: true,
		timeSensitive: false, unread: true, starred: false, hasAttachment: false, confidence: 91,
		reasonCodesJson: '["BUSINESS_CONTEXT"]', conflictingSignalsJson: '[]', authoritySource: 'DETERMINISTIC_RULES',
		decisionDigest: 'b'.repeat(64), evidenceId: 'evidence-1', idempotencyKey: 'event-idempotency-1',
		classifiedAt: '2026-07-19T20:00:01.000Z'
	},
	evidence: {
		canonicalPayloadJson: '{"bodyPersisted":false}', payloadDigest: 'c'.repeat(64), entryDigest: 'd'.repeat(64),
		observedAt: '2026-07-19T20:00:01.000Z'
	},
	head: { expectedGeneration: 0, expectedEntryDigest: null }
};

const integrity = await computeEvidenceIntegrity(input);
for (const key of ['inputDigest', 'decisionDigest', 'payloadDigest', 'entryDigest']) assert.match(integrity[key], /^[a-f0-9]{64}$/);
assert.notEqual(integrity.entryDigest, (await computeEvidenceIntegrity({
	...input,
	run: { ...input.run, runtimeDeploymentId: 'deployment-tampered' }
})).entryDigest);
assert.notEqual(integrity.entryDigest, (await computeEvidenceIntegrity({
	...input,
	run: { ...input.run, authSessionRef: 'session-tampered' }
})).entryDigest);
for (const [field, value] of [
	['domainAuthorityId', 'authority-tampered'], ['authorityGeneration', 4],
	['authorityEvidenceRef', 'authority-evidence-tampered'], ['actorUserId', 9],
	['requestId', 'ray-tampered'], ['acceptanceCorrelationRef', 'acceptance-tampered'],
	['canonicalAccountId', 11]
]) {
	assert.notEqual(integrity.entryDigest, (await computeEvidenceIntegrity({
		...input, run: { ...input.run, [field]: value }
	})).entryDigest, `entry digest must bind run.${field}`);
}
assert.notEqual(integrity.entryDigest, (await computeEvidenceIntegrity({
	...input, event: { ...input.event, primaryCategory: 'SPAM' }
})).entryDigest, 'entry digest must bind the decision');
assert.notEqual(integrity.entryDigest, (await computeEvidenceIntegrity({
	...input,
	evidence: { ...input.evidence, canonicalPayloadJson: '{"bodyPersisted":false,"verdict":"changed"}' }
})).entryDigest, 'entry digest must bind the evidence payload');
assert.equal(typeof verifyEvidenceChain, 'function');
assert.equal(typeof verifyClassificationEvidence, 'function');

const hmacEnv = { NEXORA_CORRELATION_HASH_SECRET: 'test-only-evidence-ledger-secret-32-bytes', NEXORA_CORRELATION_HMAC_KEY_VERSION: 'v1' };
const sessionRef = await deriveSessionRef(hmacEnv, 'Bearer private');
assert.match(sessionRef, /^[a-f0-9]{64}$/);
assert.equal(sessionRef, await deriveSessionRef(hmacEnv, 'Bearer private'));
assert.notEqual(sessionRef, await deriveCorrelationRef(hmacEnv, 'challenge', 'Bearer private'));
assert.notEqual(sessionRef, await deriveSessionRef({ ...hmacEnv, NEXORA_CORRELATION_HMAC_KEY_VERSION: 'v2' }, 'Bearer private'));
await assert.rejects(() => deriveSessionRef({}, 'Bearer private'), /HMAC secret/);
await assert.rejects(() => deriveSessionRef({ NEXORA_CORRELATION_HASH_SECRET: 'test-only-missing-version-secret-32-bytes' }, 'Bearer private'), /key version/);

const statements = buildAtomicLedgerStatements(db, input);
assert.equal(statements.length, 6);
assert.equal(prepared.length, 6);
assert.ok(prepared[1].sql.includes('latest_generation=?'));
assert.ok(prepared[2].sql.includes('INSERT INTO nexora_classification_runs'));
assert.ok(prepared[3].sql.includes('INSERT INTO nexora_email_classification_events'));
assert.ok(prepared[4].sql.includes('INSERT INTO nexora_email_classification_evidence_v2'));
assert.ok(prepared[5].sql.includes('current_event_id'));
assert.throws(() => buildAtomicLedgerStatements(db, {
	...input,
	evidence: { ...input.evidence, canonicalPayloadJson: '{"bodyPersisted":true}' }
}), /bodyPersisted must be false/);
assert.throws(() => buildAtomicLedgerStatements(db, {
	...input,
	evidence: { ...input.evidence, canonicalPayloadJson: '{"bodyPersisted":false,"accessToken":"secret"}' }
}), /sensitive evidence key/);

const chainDb = {
	prepare(sql) {
		const entries = sql.includes('ORDER BY e.generation ASC');
		return {
			bind(...values) {
				assert.deepEqual(values, [1, 2, 'example.com', 'google', 10, 'message-1']);
				return entries
					? { all: async () => ({ results: [{ event_id: 'event-1', evidence_id: 'evidence-1', generation: 1 }] }) }
					: { first: async () => null };
			}
		};
	}
};
assert.deepEqual(await readEvidenceChain(chainDb, {
	tenantId: 1, workspaceId: 2, customerDomain: 'example.com', provider: 'google',
	canonicalAccountId: 10, canonicalMessageId: 'message-1'
}), { entries: [{ event_id: 'event-1', evidence_id: 'evidence-1', generation: 1 }], head: null });

console.log('evidence ledger contract check passed');
