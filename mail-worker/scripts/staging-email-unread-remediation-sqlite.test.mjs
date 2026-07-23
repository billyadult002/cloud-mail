import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const remediation = readFileSync(new URL('../remediations/staging-email-unread/0001_nexora_staging_email_unread_compatibility_v1.sql', import.meta.url), 'utf8');
const migration0081 = readFileSync(new URL('../migrations/0081_nexora_durable_connection_runtime.sql', import.meta.url), 'utf8');
const migration0082 = readFileSync(new URL('../migrations/0082_nexora_connection_owner_authority.sql', import.meta.url), 'utf8');
const migration0083 = readFileSync(new URL('../migrations/0083_nexora_connection_expired_mission_rebind.sql', import.meta.url), 'utf8');
const migration0084 = readFileSync(new URL('../migrations/0084_nexora_oauth_confidential_exchange_recovery.sql', import.meta.url), 'utf8');
const stagingDriftFixture = readFileSync(new URL('./fixtures/staging-email-unread-drift.sql', import.meta.url), 'utf8');
const stagingRemediationConfig = readFileSync(new URL('../wrangler.staging-email-unread-remediation.toml', import.meta.url), 'utf8');
const remediationName = '0001_nexora_staging_email_unread_compatibility_v1.sql';
const triggerHash = '5407da48f92bde0ac391fa3f8be6d4ac8e6f9a4ff63bcfc4b78949ded04de32e';

const sha256 = (value) => createHash('sha256').update(String(value)).digest('hex');
const schemaContract = (db) => db.prepare(`
 SELECT group_concat(name||':'||type||':'||"notnull"||':'||COALESCE(dflt_value,'NULL')||':'||pk,'|') value
 FROM (SELECT name,type,"notnull",dflt_value,pk FROM pragma_table_info('email') ORDER BY cid)
`).get().value;
const triggerSql = (db) => db.prepare(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name='ucs_email_updated_outbox'`).get()?.sql;

function createFixture() {
	const db = new DatabaseSync(':memory:');
	db.exec('PRAGMA foreign_keys=ON;');
	db.exec(stagingDriftFixture);
	return db;
}

function runTransaction(db, sql) {
	db.exec('BEGIN IMMEDIATE');
	try {
		db.exec(sql);
		db.exec('COMMIT');
	} catch (error) {
		db.exec('ROLLBACK');
		throw error;
	}
}

function applyRemediationMigration(db) {
	if (db.prepare(`SELECT 1 ok FROM d1_migrations WHERE name=?`).get(remediationName)?.ok) return false;
	runTransaction(db, remediation);
	db.prepare(`INSERT INTO d1_migrations(name) VALUES(?)`).run(remediationName);
	return true;
}

function mustReject(label, action) {
	try {
		action();
		throw new Error(`${label}:accepted`);
	} catch (error) {
		if (String(error.message).includes(':accepted')) throw error;
	}
}

if (!stagingRemediationConfig.includes('database_name = "cloud-mail-staging"')
	|| !stagingRemediationConfig.includes('database_id = "acf160ae-4efd-48d0-9d1b-7500f4cd0f41"')
	|| !stagingRemediationConfig.includes('migrations_dir = "remediations/staging-email-unread"')) {
	throw new Error('staging_remediation_config_not_exactly_pinned');
}

{
	const db = createFixture();
	mustReject('pre-remediation trigger compilation', () => db.prepare('EXPLAIN UPDATE email SET subject=subject WHERE 0').all());
	if (sha256(triggerSql(db)) !== triggerHash) throw new Error('fixture_trigger_hash_mismatch');
	if (sha256(schemaContract(db)) !== '403b0f0648f1882047f10d179b122a3fb23c4f3cdbcb2c927b249a6f3d17b517') {
		throw new Error(`fixture_schema_hash_mismatch:${schemaContract(db)}`);
	}
}

for (const mutate of [
	(db) => db.exec(`DELETE FROM d1_migrations WHERE name='0081_nexora_durable_connection_runtime.sql';`),
	(db) => db.exec(`DROP TRIGGER ucs_email_updated_outbox; CREATE TRIGGER ucs_email_updated_outbox AFTER UPDATE ON email BEGIN SELECT 1; END;`),
	(db) => db.exec(`ALTER TABLE email ADD COLUMN unexpected TEXT;`),
	(db) => db.exec(`INSERT INTO email(email_id,account_id,user_id) VALUES(1,1,1);`),
	(db) => db.exec(`INSERT INTO conversation_ingest_outbox VALUES('existing',1,1,1,1,'1','observed');`),
	(db) => db.exec(`INSERT INTO workspace_account_bindings VALUES(1,1,1,'READY');`),
	(db) => db.exec(`INSERT INTO d1_migrations(name) VALUES('0082_nexora_connection_owner_authority.sql');`),
	(db) => db.exec(`INSERT INTO d1_migrations(name) VALUES('0083_nexora_connection_expired_mission_rebind.sql');`),
	(db) => db.exec(`INSERT INTO d1_migrations(name) VALUES('0084_nexora_oauth_confidential_exchange_recovery.sql');`),
	(db) => db.exec(`CREATE TABLE nexora_connections_v2(id TEXT);`),
	(db) => db.exec(`CREATE TABLE nexora_connection_operations_v2(id TEXT);`),
	(db) => db.exec(`CREATE TABLE nexora_connection_events_v2(id TEXT);`),
	(db) => db.exec(`
CREATE TABLE nexora_schema_compatibility_remediations(identifier TEXT PRIMARY KEY);
INSERT INTO nexora_schema_compatibility_remediations(identifier)
VALUES('nexora-staging-email-unread-compatibility-v1');
`),
]) {
	const db = createFixture();
	mutate(db);
	const beforeTrigger = triggerSql(db);
	mustReject('unknown staging drift', () => applyRemediationMigration(db));
	if (triggerSql(db) !== beforeTrigger || db.prepare(`SELECT COUNT(*) count FROM pragma_table_info('email') WHERE name='unread'`).get().count !== 0) {
		throw new Error('guard_failure_did_not_roll_back');
	}
}

{
	const db = createFixture();
	const beforeTrigger = triggerSql(db);
	if (!applyRemediationMigration(db)) throw new Error('first_remediation_was_noop');
	if (applyRemediationMigration(db)) throw new Error('remediation_idempotency_failed');
	if (triggerSql(db) !== beforeTrigger || sha256(triggerSql(db)) !== triggerHash) throw new Error('trigger_parity_failed');
	if (sha256(schemaContract(db)) !== '60df64ac19d9919b53dfd71684e52572487c6f4dbfbf51412d150e2e89cfb041') {
		throw new Error('post_remediation_schema_hash_mismatch');
	}
	if (db.prepare(`SELECT COUNT(*) count FROM nexora_schema_compatibility_remediations`).get().count !== 1
		|| db.prepare(`SELECT COUNT(*) count FROM d1_migrations WHERE name=?`).get(remediationName).count !== 1) {
		throw new Error('remediation_ledger_exact_once_failed');
	}
	db.prepare('EXPLAIN UPDATE email SET subject=subject WHERE 0').all();

	db.exec(`
INSERT INTO workspace_account_bindings VALUES(10,77,11,'READY');
INSERT INTO workspace_account_bindings VALUES(20,77,22,'SUSPENDED');
INSERT INTO email(email_id,account_id,user_id,subject,text) VALUES(1,77,11,'before','body');
UPDATE email SET subject='after' WHERE email_id=1;
UPDATE email SET subject='after' WHERE email_id=1;
UPDATE email SET name='unrelated' WHERE email_id=1;
UPDATE email SET unread=1 WHERE email_id=1;
`);
	const outbox = db.prepare(`SELECT tenant_id,workspace_id,event_type,source_version FROM conversation_ingest_outbox ORDER BY source_version`).all();
	if (outbox.length !== 2
		|| outbox.some((row) => row.tenant_id !== 11 || row.workspace_id !== 10 || row.event_type !== 'updated')
		|| !outbox.some((row) => String(row.source_version).startsWith('0:'))
		|| !outbox.some((row) => String(row.source_version).startsWith('1:'))) {
		throw new Error('trigger_semantic_parity_or_deduplication_failed');
	}
}

{
	const db = createFixture();
	db.exec(`
CREATE TABLE mission_runtime_evidence(id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,status TEXT,summary_json TEXT);
CREATE TABLE mission_runtime_verifications(id TEXT PRIMARY KEY,evidence_id TEXT,claim_id TEXT,tenant_id INTEGER,workspace_id INTEGER,state TEXT,integrity_state TEXT,verifier TEXT);
CREATE TABLE nexora_onboarding_refresh_work(id TEXT PRIMARY KEY);
CREATE TABLE nexora_onboarding_tokens(id TEXT PRIMARY KEY,rotation_generation INTEGER);
CREATE TABLE nexora_onboarding_token_connection_bindings(token_id TEXT,token_generation INTEGER,connection_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,connection_generation INTEGER);
CREATE TABLE nexora_callback_verified_results(
 id TEXT PRIMARY KEY,mission_id TEXT,authorization_session_id TEXT,result_status TEXT,callback_correlation_id TEXT,
 tenant_id INTEGER,workspace_id INTEGER,provider TEXT,provider_connection_id TEXT,provider_connection_generation INTEGER,token_generation INTEGER
);
CREATE TABLE nexora_onboarding_authorization_sessions(
 id TEXT PRIMARY KEY,onboarding_mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,
 provider TEXT,client_registration_mode TEXT,redirect_uri_id TEXT,scopes_json TEXT,
 incremental_scopes_json TEXT,state_hash TEXT,nonce_hash TEXT,pkce_challenge TEXT,
 pkce_challenge_method TEXT,pkce_verifier_hash TEXT,tenant_hint TEXT,login_hint_hash TEXT,
 status TEXT,created_at TEXT,expires_at TEXT,consumed_at TEXT,callback_fingerprint TEXT,resume_checkpoint TEXT
);
CREATE TABLE nexora_onboarding_callback_correlations(
 id TEXT PRIMARY KEY,authorization_session_id TEXT,onboarding_mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT
);
CREATE TABLE nexora_onboarding_callback_claims(
 id TEXT PRIMARY KEY,authorization_session_id TEXT,correlation_id TEXT,onboarding_mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,
 lease_owner TEXT,lease_expires_at TEXT,fencing_token INTEGER,claim_status TEXT,recovery_mode TEXT
);
CREATE TABLE workspaces(id INTEGER PRIMARY KEY,tenant_key TEXT NOT NULL);
CREATE TABLE workspace_members(workspace_id INTEGER,user_id INTEGER,role TEXT,PRIMARY KEY(workspace_id,user_id));
CREATE TABLE account(account_id INTEGER PRIMARY KEY,user_id INTEGER,is_del INTEGER NOT NULL DEFAULT 0);
CREATE TABLE nexora_domain_authorities(id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,generation INTEGER,verification_status TEXT,revoked_at TEXT);
CREATE TABLE workspace_membership_authorities(id TEXT PRIMARY KEY,tenant_key TEXT,workspace_id INTEGER,subject_user_id INTEGER,state TEXT,authority_generation INTEGER,expires_at TEXT);
CREATE TABLE workspace_account_delegations(
 id TEXT PRIMARY KEY,tenant_key TEXT,workspace_id INTEGER,account_id INTEGER,owner_user_id INTEGER,subject_user_id INTEGER,
 scope_json TEXT,state TEXT,authority_generation INTEGER,owner_consent_at TEXT,approved_at TEXT,expires_at TEXT
);
`);
	db.exec(migration0081);
	applyRemediationMigration(db);
	db.exec(migration0082);
	db.prepare(`INSERT INTO d1_migrations(name) VALUES(?)`).run('0082_nexora_connection_owner_authority.sql');
	db.exec(migration0083);
	db.prepare(`INSERT INTO d1_migrations(name) VALUES(?)`).run('0083_nexora_connection_expired_mission_rebind.sql');
	db.exec(migration0084);
	db.prepare(`INSERT INTO d1_migrations(name) VALUES(?)`).run('0084_nexora_oauth_confidential_exchange_recovery.sql');
	if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('migration_chain_foreign_key_failure');
	if (db.prepare(`SELECT COUNT(*) count FROM d1_migrations WHERE name BETWEEN '0081_' AND '0084_zzzz'`).get().count !== 4) {
		throw new Error('migration_chain_ledger_failure');
	}
	const unsafeColumns = db.prepare(`
 SELECT m.name table_name,p.name column_name
 FROM sqlite_master m JOIN pragma_table_info(m.name) p
 WHERE m.type='table' AND m.name LIKE 'nexora_oauth_%'
   AND lower(p.name) IN ('authorization_code','raw_callback_query','access_token','refresh_token','client_secret')
 `).all();
	if (unsafeColumns.length) throw new Error('raw_oauth_artifact_column_detected');
}

console.log('PASS_STAGING_EMAIL_UNREAD_REMEDIATION_SQLITE');
