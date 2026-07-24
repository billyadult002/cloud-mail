import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(`CREATE TABLE user(user_id INTEGER PRIMARY KEY,email TEXT NOT NULL DEFAULT 'owner@example.test');
	CREATE TABLE account(account_id INTEGER PRIMARY KEY,email TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT '',user_id INTEGER,is_del INTEGER NOT NULL DEFAULT 0);
	CREATE TABLE workspaces(id INTEGER PRIMARY KEY,tenant_key TEXT NOT NULL,display_name TEXT NOT NULL,created_by_user_id INTEGER NOT NULL);
	CREATE TABLE workspace_members(workspace_id INTEGER,user_id INTEGER,role TEXT);`);
const authorityTables = [
	'workspace_domains',
	'workspace_account_bindings', 'workspace_account_delegations',
	'workspace_membership_authorities', 'nexora_onboarding_state',
	'nexora_onboarding_authorization_sessions', 'nexora_onboarding_tokens',
	'nexora_onboarding_provider_connections', 'nexora_connections',
	'nexora_connection_operations', 'nexora_oauth_authorization_session_bindings',
	'nexora_oauth_callback_intakes', 'nexora_oauth_exchange_attempts',
	'nexora_onboarding_callback_correlations', 'nexora_onboarding_callback_claims',
	'nexora_onboarding_callback_checkpoints', 'nexora_onboarding_refresh_work',
	'nexora_onboarding_reauthorization_work', 'nexora_onboarding_reauthorization_commit_results',
	'nexora_onboarding_token_connection_bindings', 'nexora_callback_verification_attempts',
	'nexora_callback_verified_results', 'nexora_callback_verified_outcome_finalizations',
	'nexora_callback_verifier_authorizations', 'nexora_callback_correlation_consumption_results',
	'nexora_provider_outcome_results',
];
for (const table of authorityTables) db.exec(`CREATE TABLE ${table}(id INTEGER PRIMARY KEY)`);

const migration = readFileSync(new URL('../staging-migrations/0085_nexora_secure_staging_bootstrap.sql', import.meta.url), 'utf8');
db.exec(migration);

const entitySource = readFileSync(new URL('../src/entity/setting.js', import.meta.url), 'utf8');
const entityColumns = [...entitySource.matchAll(/(?:integer|text)\('([^']+)'/g)].map(match => match[1]).sort();
const migrationColumns = db.prepare(`PRAGMA table_info(setting)`).all().map(row => row.name).sort();
if (JSON.stringify(entityColumns) !== JSON.stringify(migrationColumns)) {
	throw new Error(`secure_staging_bootstrap_setting_schema_mismatch`);
}

db.prepare(`
	INSERT INTO nexora_staging_bootstrap_operations(singleton_id,operation_id,request_digest,state)
	VALUES(1,?,?,?)
`).run('integrity-check', 'a'.repeat(64), 'DB_COMMITTED');
db.exec(`INSERT INTO setting DEFAULT VALUES`);
db.prepare(`
	UPDATE nexora_staging_bootstrap_operations
	SET state='KV_REFRESHING',refresh_owner='integrity-check',refresh_lease_expires_at=datetime('now','+2 minutes')
	WHERE singleton_id=1
`).run();
db.prepare(`
	UPDATE nexora_staging_bootstrap_operations
	SET state='READY_FOR_FIRST_AUTHORITY',refresh_owner=NULL,refresh_lease_expires_at=NULL
	WHERE singleton_id=1
`).run();
db.exec(`INSERT INTO user(user_id) VALUES(1)`);
let secondFirstUserRejected = false;
try {
	db.exec(`INSERT INTO user(user_id) VALUES(2)`);
} catch {
	secondFirstUserRejected = true;
}
if (!secondFirstUserRejected) throw new Error(`secure_staging_bootstrap_first_authority_guard_missing`);
if (db.prepare(`SELECT user_id FROM account`).get()?.user_id !== 1) {
	throw new Error(`secure_staging_bootstrap_first_account_atomicity_missing`);
}
if (db.prepare(`SELECT state FROM nexora_staging_bootstrap_operations`).get()?.state !== 'FIRST_USER_CREATED') {
	throw new Error(`secure_staging_bootstrap_first_user_checkpoint_missing`);
}
db.exec(`INSERT INTO workspaces(id,tenant_key,display_name,created_by_user_id) VALUES(1,'user:1','NEXORA Staging',1);
	INSERT INTO workspace_members(workspace_id,user_id,role) VALUES(1,1,'OWNER')`);
db.prepare(`
	UPDATE nexora_staging_bootstrap_operations
	SET state='COMPLETE',completed_at=CURRENT_TIMESTAMP
	WHERE singleton_id=1
`).run();

for (const statement of [
	`DELETE FROM nexora_staging_bootstrap_operations`,
	`UPDATE nexora_staging_bootstrap_operations SET state='DB_COMMITTED'`,
]) {
	let rejected = false;
	try {
		db.exec(statement);
	} catch {
		rejected = true;
	}
	if (!rejected) throw new Error(`secure_staging_bootstrap_guard_missing`);
}

console.log(`PASS_SECURE_STAGING_BOOTSTRAP_SQLITE_INTEGRITY columns=${migrationColumns.length}`);
