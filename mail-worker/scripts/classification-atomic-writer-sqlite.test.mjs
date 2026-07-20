import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { classifyCanonicalAndPersist, readCanonicalClassification } from '../src/service/nexora-email-classification-service.mjs';
import { deriveSessionRef } from '../src/service/nexora-session-ref-service.mjs';

const authHeader = 'test-atomic-writer-authorization';
const continuityEnv = {
	NEXORA_CORRELATION_HASH_SECRET: 'test-only-atomic-writer-continuity-secret',
	NEXORA_CORRELATION_HMAC_KEY_VERSION: 'test-v1',
	CF_VERSION_METADATA: { id: 'deployment-1' },
	NEXORA_ACCEPTANCE_BUILDS_JSON: JSON.stringify([{
		platform: 'DESKTOP', buildId: 'build', buildVersion: '1',
		artifactDigest: 'a'.repeat(64), sourceCommit: 'b'.repeat(40),
		signingIdentity: 'signer-1', signingKeyVersion: 'key-1', policyVersion: 'policy-1',
		validFrom: '2020-01-01T00:00:00.000Z', validUntil: '2999-01-01T00:00:00.000Z'
	}])
};
const authSessionRef = await deriveSessionRef(continuityEnv, authHeader);

const sqlite = new DatabaseSync(':memory:');
sqlite.exec('PRAGMA foreign_keys=ON');
sqlite.exec(`
 CREATE TABLE workspace_domains(id INTEGER PRIMARY KEY,workspace_id INTEGER NOT NULL,domain TEXT UNIQUE,provider TEXT,authority_state TEXT,lifecycle_state TEXT,health_state TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE nexora_domain_ownership_challenges(id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,normalized_domain TEXT,challenge_name TEXT,challenge_token_hash TEXT,verification_status TEXT,administrator_authority_ref TEXT,idempotency_key TEXT,expires_at TEXT,verification_evidence_ref TEXT,attempt INTEGER DEFAULT 0,verified_at TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE workspace_members(workspace_id INTEGER,user_id INTEGER,role TEXT,PRIMARY KEY(workspace_id,user_id));
 CREATE TABLE workspace_account_bindings(workspace_id INTEGER,account_id INTEGER,PRIMARY KEY(workspace_id,account_id));
 CREATE TABLE account(account_id INTEGER PRIMARY KEY,user_id INTEGER,email TEXT,domain TEXT,provider TEXT,sync_status TEXT,is_del INTEGER DEFAULT 0);
 CREATE TABLE email(email_id INTEGER PRIMARY KEY,account_id INTEGER,user_id INTEGER,send_email TEXT,subject TEXT,text TEXT,content TEXT,message_id TEXT,resend_email_id TEXT,relation TEXT,in_reply_to TEXT,unread INTEGER,create_time TEXT,is_del INTEGER DEFAULT 0);
 CREATE TABLE attachments(att_id INTEGER PRIMARY KEY,email_id INTEGER);
 CREATE TABLE star(star_id INTEGER PRIMARY KEY,email_id INTEGER,user_id INTEGER);
`);
sqlite.exec(readFileSync(new URL('../migrations/0077_nexora_evidence_first_hybrid_classification.sql', import.meta.url), 'utf8'));
sqlite.exec(readFileSync(new URL('../migrations/0079_nexora_p0_authority_evidence_correlation.sql', import.meta.url), 'utf8'));

class Statement {
	constructor(statement) { this.statement = statement; }
	bind(...values) { this.values = values; return this; }
	async first() { return this.statement.get(...(this.values || [])); }
	async all() { return { results: this.statement.all(...(this.values || [])) }; }
	async run() { const result = this.statement.run(...(this.values || [])); return { meta: { changes: Number(result.changes) } }; }
}
const db = {
	prepare(sql) { return new Statement(sqlite.prepare(sql)); },
	async batch(statements) {
		sqlite.exec('BEGIN IMMEDIATE');
		try {
			const results = [];
			for (const statement of statements) results.push(await statement.run());
			sqlite.exec('COMMIT');
			return results;
		} catch (error) {
			sqlite.exec('ROLLBACK');
			throw error;
		}
	}
};

sqlite.exec(`
 INSERT INTO workspace_domains(id,workspace_id,domain,authority_state,lifecycle_state,health_state) VALUES(1,9,'verified.example','VERIFIED','READY','READY');
 INSERT INTO workspace_members VALUES(9,7,'ADMIN');
 INSERT INTO workspace_account_bindings VALUES(9,12);
 INSERT INTO account VALUES(12,7,'owner@verified.example','verified.example','google','mailbox_ready',0);
 INSERT INTO email VALUES(42,12,7,'billing@vendor.example','Invoice payment required','Payment required by Friday.','PRIVATE BODY','provider-42',NULL,'','',1,'2026-07-19T10:00:00.000Z',0);
 INSERT INTO nexora_domain_authorities(id,tenant_id,workspace_id,normalized_domain,verification_status,verification_method,verification_evidence_ref,administrator_authority_ref,generation)
 VALUES('authority-1',7,9,'verified.example','verified','DNS_TXT','authority-evidence-1','admin:7',1);
 INSERT INTO nexora_runtime_acceptance_sessions(id,tenant_id,workspace_id,actor_user_id,canonical_account_id,platform,build_id,build_version,runtime_deployment_id,artifact_digest,source_commit,signing_identity,signing_key_version,allowlist_policy_version,challenge_hash,auth_session_ref,hmac_key_version,request_id,idempotency_key,status,expires_at)
 VALUES('session-1',7,9,7,12,'DESKTOP','build','1','deployment-1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','signer-1','key-1','policy-1','challenge','placeholder','test-v1','request-1','session-key','ISSUED','2999-01-01T00:00:00.000Z');
`);
sqlite.prepare("UPDATE nexora_runtime_acceptance_sessions SET auth_session_ref=? WHERE id='session-1'").run(authSessionRef);

const context = { env: { db, ...continuityEnv }, req: { header: (name) => name.toLowerCase() === 'authorization' ? authHeader : null } };
const request = { acceptanceSessionId: 'session-1', canonicalMessageId: 42, actor: { userId: 7 } };
const otherCredentialContext = {
	env: context.env,
	req: { header: (name) => name.toLowerCase() === 'authorization' ? 'different-test-authorization' : null }
};
await assert.rejects(() => classifyCanonicalAndPersist(otherCredentialContext, request), /auth session continuity/);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM nexora_classification_runs').get().n, 0);
const otherDeploymentContext = {
	env: { ...context.env, CF_VERSION_METADATA: { id: 'different-deployment' } },
	req: context.req
};
await assert.rejects(() => classifyCanonicalAndPersist(otherDeploymentContext, request), /deployment continuity/);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM nexora_classification_runs').get().n, 0);
const first = await classifyCanonicalAndPersist(context, request);
assert.equal(first.generation, 1);
assert.equal(first.provenance.bodyPersisted, false);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM nexora_classification_runs').get().n, 1);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM nexora_email_classification_events').get().n, 1);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM nexora_email_classification_evidence_v2').get().n, 1);

const replay = await classifyCanonicalAndPersist(context, request);
assert.equal(replay.idempotentReplay, true);
assert.equal(replay.runId, first.runId);
assert.equal(replay.eventId, first.eventId);
assert.equal(replay.evidenceId, first.evidenceId);
assert.equal(replay.generation, 1);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM nexora_classification_runs').get().n, 1);

sqlite.prepare("UPDATE email SET subject='Changed canonical input' WHERE email_id=42").run();
await assert.rejects(() => classifyCanonicalAndPersist(context, request), /classification idempotency input conflict/);
assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM nexora_classification_runs').get().n, 1);
sqlite.prepare("UPDATE email SET subject='Invoice payment required' WHERE email_id=42").run();

sqlite.prepare("UPDATE nexora_runtime_acceptance_sessions SET status='CONSUMED' WHERE id='session-1'").run();
const readback = await readCanonicalClassification(context, request);
assert.equal(readback.classification.id, first.classificationId);
assert.equal(readback.evidence.length, 1);
assert.equal(readback.evidence[0].bodyPersisted, false);
assert.equal(JSON.stringify(readback).includes('PRIVATE BODY'), false);
await assert.rejects(() => readCanonicalClassification(otherCredentialContext, request), /auth session continuity/);
await assert.rejects(() => readCanonicalClassification(otherDeploymentContext, request), /deployment continuity/);

sqlite.exec('DROP TRIGGER trg_nexora_classification_events_no_update');
sqlite.prepare('UPDATE nexora_email_classification_events SET generation=2 WHERE id=?').run(first.eventId);
await assert.rejects(() => readCanonicalClassification(context, request), /classification evidence integrity mismatch: generation gap/);
sqlite.prepare('UPDATE nexora_email_classification_events SET generation=1 WHERE id=?').run(first.eventId);

const originalPayload = sqlite.prepare('SELECT canonical_payload_json FROM nexora_email_classification_evidence_v2 WHERE id=?').get(first.evidenceId).canonical_payload_json;
sqlite.exec('DROP TRIGGER trg_nexora_evidence_v2_no_update');
sqlite.prepare('UPDATE nexora_email_classification_evidence_v2 SET canonical_payload_json=? WHERE id=?').run('{"bodyPersisted":false}', first.evidenceId);
await assert.rejects(() => readCanonicalClassification(context, request), /classification evidence integrity mismatch: payload digest/);
sqlite.prepare('UPDATE nexora_email_classification_evidence_v2 SET canonical_payload_json=? WHERE id=?').run(originalPayload, first.evidenceId);
sqlite.prepare("UPDATE nexora_classification_ledger_heads SET latest_entry_digest=? WHERE canonical_message_id='42'").run('0'.repeat(64));
await assert.rejects(() => readCanonicalClassification(context, request), /classification evidence integrity mismatch: head digest/);
sqlite.prepare("UPDATE nexora_classification_ledger_heads SET latest_entry_digest=? WHERE canonical_message_id='42'").run(first.evidenceRef);

sqlite.exec(`
 INSERT INTO email VALUES(43,12,7,'sender@example.net','Hello','Canonical message','OTHER PRIVATE BODY','provider-43',NULL,'','',0,'2026-07-19T11:00:00.000Z',0);
 INSERT INTO nexora_runtime_acceptance_sessions(id,tenant_id,workspace_id,actor_user_id,canonical_account_id,platform,build_id,build_version,runtime_deployment_id,artifact_digest,source_commit,signing_identity,signing_key_version,allowlist_policy_version,challenge_hash,auth_session_ref,hmac_key_version,request_id,idempotency_key,status,expires_at)
 VALUES('session-2',7,9,7,12,'DESKTOP','build','1','deployment-1','aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa','bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb','signer-1','key-1','policy-1','challenge','placeholder','test-v1','request-2','session-key-2','ISSUED','2999-01-01T00:00:00.000Z');
 CREATE TRIGGER reject_classification_evidence BEFORE INSERT ON nexora_email_classification_evidence_v2 BEGIN SELECT RAISE(ABORT,'forced evidence failure'); END;
`);
sqlite.prepare("UPDATE nexora_runtime_acceptance_sessions SET auth_session_ref=? WHERE id='session-2'").run(authSessionRef);
await assert.rejects(
	() => classifyCanonicalAndPersist(context, { acceptanceSessionId: 'session-2', canonicalMessageId: 43, actor: { userId: 7 } }),
	/forced evidence failure/
);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM nexora_classification_runs WHERE request_id='request-2'").get().n, 0);
assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM nexora_classification_ledger_heads WHERE canonical_message_id='43'").get().n, 0);

await assert.rejects(
	() => classifyCanonicalAndPersist(context, { acceptanceSessionId: 'session-2', canonicalMessageId: 43, actor: { userId: 8 } }),
	/not authorized/
);
await assert.rejects(
	() => classifyCanonicalAndPersist(context, { acceptanceSessionId: 'session-2', canonicalMessageId: 43, actor: { userId: 7 }, tenantId: 8 }),
	/tenantId is server-derived/
);

console.log('classification atomic writer SQLite test passed');
