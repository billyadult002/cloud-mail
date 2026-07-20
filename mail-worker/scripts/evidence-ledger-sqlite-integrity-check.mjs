import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import {
	buildAtomicLedgerStatements,
	canonicalize,
	computeEvidenceIntegrity,
	verifyClassificationEvidence,
	verifyEvidenceChain
} from '../src/service/nexora-evidence-ledger-service.mjs';

const migration = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');
const identity = {
	tenantId: 1, workspaceId: 2, customerDomain: 'example.com', provider: 'google',
	canonicalAccountId: 10, canonicalMessageId: 'message-1'
};

function d1(db) {
	return {
		prepare(sql) {
			return {
				bind(...values) {
					return {
						sql, values,
						all: async () => ({ results: db.prepare(sql).all(...values) }),
						first: async () => db.prepare(sql).get(...values) || null
					};
				}
			};
		},
		async batch(statements) {
			db.exec('BEGIN IMMEDIATE');
			try {
				const results = statements.map(({ sql, values }) => ({ meta: db.prepare(sql).run(...values) }));
				db.exec('COMMIT');
				return results;
			} catch (error) {
				db.exec('ROLLBACK');
				throw error;
			}
		}
	};
}

function database() {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys=ON');
	db.exec(`CREATE TABLE workspace_domains(
	 id INTEGER PRIMARY KEY,workspace_id INTEGER NOT NULL,domain TEXT NOT NULL UNIQUE
	)`);
	db.exec(migration('0077_nexora_evidence_first_hybrid_classification.sql'));
	db.exec(migration('0078_nexora_domain_ownership_validation.sql'));
	db.exec(migration('0079_nexora_p0_authority_evidence_correlation.sql'));
	return db;
}

async function append(db, generation = 1, previous = null) {
	const at = `2026-07-19T20:00:0${generation}.000Z`;
	const input = {
		run: {
			id: `run-${generation}`, tenantId: 1, workspaceId: 2, domainAuthorityId: 'authority-1', authorityGeneration: 3,
			authorityEvidenceRef: 'authority-evidence-1', actorUserId: 1, authSessionRef: 'session-hmac', hmacKeyVersion: 'test-v1',
			canonicalAccountId: 10, providerAccountHash: 'provider-account-hash', requestId: `ray-${generation}`,
			runtimeDeploymentId: 'deployment-1', acceptanceCorrelationRef: 'acceptance-hmac', clientKind: 'DESKTOP',
			classifierVersion: 'classifier-v1', rulesVersion: 'rules-v1', modelVersion: null,
			idempotencyKey: `run-idempotency-${generation}`, startedAt: at
		},
		event: {
			id: `event-${generation}`, classificationId: 'classification-1', customerDomain: 'example.com', provider: 'google',
			canonicalMessageId: 'message-1', sourceCreatedAt: '2026-07-19T19:59:00.000Z', provenanceRef: 'provider:message-1',
			messageFingerprint: 'message-fingerprint', generation, previousEventId: previous?.eventId || null,
			previousEntryDigest: previous?.entryDigest || null, primaryCategory: 'BUSINESS', vipRelationship: false,
			priorityLevel: 'NORMAL', requiresAction: true, timeSensitive: false, unread: true, starred: false,
			hasAttachment: false, confidence: 91, reasonCodesJson: '["BUSINESS_CONTEXT"]', conflictingSignalsJson: '[]',
			authoritySource: 'DETERMINISTIC_RULES', vipAuthorityRef: null, userOverrideRef: null,
			administratorOverrideRef: null, evidenceId: `evidence-${generation}`,
			idempotencyKey: `event-idempotency-${generation}`, classifiedAt: at
		},
		evidence: {
			canonicalPayloadJson: canonicalize({
				bodyPersisted: false, classificationId: 'classification-1', generation,
				primaryCategory: 'BUSINESS', reasonCodes: ['BUSINESS_CONTEXT']
			}),
			observedAt: at
		},
		head: { expectedGeneration: generation - 1, expectedEntryDigest: previous?.entryDigest || null }
	};
	Object.assign(input.run, { inputDigest: '0'.repeat(64) });
	Object.assign(input.event, { decisionDigest: '0'.repeat(64) });
	Object.assign(input.evidence, { payloadDigest: '0'.repeat(64), entryDigest: '0'.repeat(64) });
	const integrity = await computeEvidenceIntegrity(input);
	input.run.inputDigest = integrity.inputDigest;
	input.event.decisionDigest = integrity.decisionDigest;
	input.evidence.payloadDigest = integrity.payloadDigest;
	input.evidence.entryDigest = integrity.entryDigest;
	const adapter = d1(db);
	const result = await adapter.batch(buildAtomicLedgerStatements(adapter, input));
	assert.deepEqual(result.slice(1).map((row) => Number(row.meta.changes)), [1, 1, 1, 1, 1]);
	return { eventId: input.event.id, entryDigest: integrity.entryDigest };
}

async function expectIntegrityFailure(mutator, pattern) {
	const db = database();
	try {
		const first = await append(db);
		await mutator(db, first);
		await assert.rejects(() => verifyEvidenceChain(d1(db), identity), pattern);
	} finally {
		db.close();
	}
}

{
	const db = database();
	try {
		const first = await append(db);
		await append(db, 2, first);
		const verified = await verifyEvidenceChain(d1(db), identity);
		assert.equal(verified.valid, true);
		assert.equal(verified.entries.length, 2);
		assert.equal(verified.head.latest_generation, 2);
		const classificationEvidence = await verifyClassificationEvidence(d1(db), {
			tenantId: 1,
			workspaceId: 2,
			canonicalAccountId: 10,
			classificationId: 'classification-1'
		});
		assert.equal(classificationEvidence.valid, true);
		assert.equal(classificationEvidence.eventId, 'event-2');
		assert.equal(classificationEvidence.evidenceId, 'evidence-2');
		assert.equal(classificationEvidence.generation, 2);
		db.exec("UPDATE nexora_email_classifications SET evidence_ref='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'");
		await assert.rejects(() => verifyClassificationEvidence(d1(db), {
			tenantId: 1, workspaceId: 2, canonicalAccountId: 10, classificationId: 'classification-1'
		}), /projection evidence ref/);
	} finally {
		db.close();
	}
}

await expectIntegrityFailure((db) => {
	db.exec('DROP TRIGGER trg_nexora_classification_runs_no_update');
	db.exec("UPDATE nexora_classification_runs SET runtime_deployment_id='tampered' WHERE id='run-1'");
}, /input digest|entry digest/);

await expectIntegrityFailure((db) => {
	db.exec('DROP TRIGGER trg_nexora_evidence_v2_no_update');
	db.exec("UPDATE nexora_email_classification_evidence_v2 SET canonical_payload_json='{\"bodyPersisted\":false,\"primaryCategory\":\"SPAM\"}' WHERE id='evidence-1'");
}, /payload digest/);

await expectIntegrityFailure(async (db, first) => {
	await append(db, 2, first);
	db.exec('DROP TRIGGER trg_nexora_classification_events_no_delete');
	db.exec('DROP TRIGGER trg_nexora_evidence_v2_no_delete');
	db.exec('PRAGMA foreign_keys=OFF');
	db.exec("DELETE FROM nexora_email_classification_evidence_v2 WHERE generation=1");
	db.exec("DELETE FROM nexora_email_classification_events WHERE generation=1");
}, /generation gap/);

await expectIntegrityFailure(async (db, first) => {
	await append(db, 2, first);
	db.exec('DROP TRIGGER trg_nexora_classification_events_no_update');
	db.exec('DROP TRIGGER trg_nexora_evidence_v2_no_update');
	db.exec("UPDATE nexora_email_classification_events SET previous_entry_digest='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' WHERE generation=2");
	db.exec("UPDATE nexora_email_classification_evidence_v2 SET previous_entry_digest='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' WHERE generation=2");
}, /previous entry digest/);

await expectIntegrityFailure((db) => {
	db.exec("UPDATE nexora_classification_ledger_heads SET latest_entry_digest='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'");
}, /head digest/);

await expectIntegrityFailure((db) => {
	db.exec('DROP TRIGGER trg_nexora_evidence_v2_no_update');
	db.exec("UPDATE nexora_email_classification_evidence_v2 SET provider_account_hash='cross-account' WHERE id='evidence-1'");
}, /tuple provider_account_hash/);

console.log('evidence ledger sqlite integrity check passed');
