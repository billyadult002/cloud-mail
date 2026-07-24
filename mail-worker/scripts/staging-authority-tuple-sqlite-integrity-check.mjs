import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(`
	CREATE TABLE organizations(id INTEGER PRIMARY KEY,org_key TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL);
	CREATE TABLE workspace_account_delegations(
	 id TEXT PRIMARY KEY,workspace_id INTEGER NOT NULL,account_id INTEGER NOT NULL,
	 subject_user_id INTEGER NOT NULL,state TEXT NOT NULL,scope_json TEXT NOT NULL
	);
`);
const migration = readFileSync(new URL('../staging-migrations/0086_nexora_staging_authority_tuple.sql', import.meta.url), 'utf8');
db.exec(migration);
db.exec(migration);

db.prepare(`
	INSERT INTO nexora_staging_authority_tuple_operations(
	 singleton_id,operation_id,request_digest,state,normalized_domain,challenge_expires_at,worker_version
	) VALUES(1,'tuple-op',?,'IDENTITY_READY','authority-staging.example.test','2099-07-23T00:00:00.000Z','worker-v1')
`).run('a'.repeat(64));
db.prepare(`
	UPDATE nexora_staging_authority_tuple_operations
	SET state='DNS_CHALLENGE_READY',domain_challenge_id='challenge-1',domain_challenge_generation=1
	WHERE singleton_id=1
`).run();

let invalidCompletionRejected = false;
try {
	db.exec(`UPDATE nexora_staging_authority_tuple_operations SET state='COMPLETE',completed_at=CURRENT_TIMESTAMP WHERE singleton_id=1`);
} catch {
	invalidCompletionRejected = true;
}
if (!invalidCompletionRejected) throw new Error('staging_authority_tuple_unverified_completion_allowed');

db.exec(`
	INSERT INTO workspace_account_delegations(id,workspace_id,account_id,subject_user_id,state,scope_json)
	VALUES('delegation-1',1,1,1,'active','["mail_read"]')
`);
let duplicateDelegationRejected = false;
try {
	db.exec(`
		INSERT INTO workspace_account_delegations(id,workspace_id,account_id,subject_user_id,state,scope_json)
		VALUES('delegation-2',1,1,1,'active','["mail_read"]')
	`);
} catch {
	duplicateDelegationRejected = true;
}
if (!duplicateDelegationRejected) throw new Error('staging_authority_tuple_duplicate_mail_read_allowed');

let deleteRejected = false;
try {
	db.exec(`DELETE FROM nexora_staging_authority_tuple_operations`);
} catch {
	deleteRejected = true;
}
if (!deleteRejected) throw new Error('staging_authority_tuple_delete_allowed');

db.prepare(`
	UPDATE nexora_staging_authority_tuple_operations
	SET state='REVOKED',revoked_at=CURRENT_TIMESTAMP
	WHERE singleton_id=1
`).run();
if (db.prepare(`SELECT state FROM nexora_staging_authority_tuple_operations`).get()?.state !== 'REVOKED') {
	throw new Error('staging_authority_tuple_precommit_rollback_missing');
}

console.log('PASS_STAGING_AUTHORITY_TUPLE_SQLITE_INTEGRITY');
