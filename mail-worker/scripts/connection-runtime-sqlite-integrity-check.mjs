import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(`PRAGMA foreign_keys=ON;
CREATE TABLE mission_runtime_evidence(id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,status TEXT,summary_json TEXT);
CREATE TABLE mission_runtime_verifications(id TEXT PRIMARY KEY,evidence_id TEXT,claim_id TEXT,tenant_id INTEGER,workspace_id INTEGER,state TEXT,integrity_state TEXT,verifier TEXT);
CREATE TABLE nexora_onboarding_refresh_work(id TEXT PRIMARY KEY);
CREATE TABLE nexora_onboarding_tokens(id TEXT PRIMARY KEY,rotation_generation INTEGER);
CREATE TABLE nexora_onboarding_token_connection_bindings(token_id TEXT,token_generation INTEGER,connection_id TEXT);
CREATE TABLE nexora_callback_verified_results(id TEXT PRIMARY KEY,authorization_session_id TEXT,result_status TEXT);
CREATE TABLE nexora_onboarding_authorization_sessions(
 id TEXT PRIMARY KEY,onboarding_mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,
 provider TEXT,client_registration_mode TEXT,redirect_uri_id TEXT,scopes_json TEXT,
 incremental_scopes_json TEXT,state_hash TEXT,nonce_hash TEXT,pkce_challenge TEXT,
 pkce_challenge_method TEXT,pkce_verifier_hash TEXT,tenant_hint TEXT,login_hint_hash TEXT,
 status TEXT,created_at TEXT,expires_at TEXT,consumed_at TEXT,callback_fingerprint TEXT,
 resume_checkpoint TEXT
);`);
const migration0081 = readFileSync(new URL('../migrations/0081_nexora_durable_connection_runtime.sql', import.meta.url), 'utf8');
const migration0082 = readFileSync(new URL('../migrations/0082_nexora_connection_owner_authority.sql', import.meta.url), 'utf8');
const migration0083 = readFileSync(new URL('../migrations/0083_nexora_connection_expired_mission_rebind.sql', import.meta.url), 'utf8');
db.exec(migration0081);
db.exec(migration0081);

db.exec(`INSERT INTO nexora_connections(id,tenant_id,workspace_id,normalized_domain,domain_authority_id,domain_authority_generation,provider,account_id,onboarding_mission_id,state,authority_generation,lease_owner,lease_expires_at,fencing_token) VALUES('rebuild-preserved',7,8,'preserved.example','da-preserved',3,'google',9,'mission-preserved','DISCOVERED',4,'rebuild-owner','2999-01-01 00:00:00',2);
INSERT INTO mission_runtime_evidence VALUES('rebuild-evidence',7,8,'supported','{"operation_id":"rebuild-operation"}');
INSERT INTO mission_runtime_verifications VALUES('rebuild-verification','rebuild-evidence','connection-claim:rebuild-operation',7,8,'verified','valid','canonical_connection_policy_v1');
INSERT INTO nexora_connection_operations(id,connection_id,tenant_id,workspace_id,operation_type,idempotency_key,expected_authority_generation,expected_connection_generation,expected_credential_generation,lease_owner,lease_expires_at,fencing_token,transition_from_state,transition_to_state,state,request_digest,authority_tuple_digest,evidence_id,verification_id,claim_id) VALUES('rebuild-operation','rebuild-preserved',7,8,'REAUTHORIZE','rebuild-preserved',4,1,0,'rebuild-owner','2999-01-01 00:00:00',2,'DISCOVERED','REAUTHORIZATION_REQUIRED','VERIFIED','${'6'.repeat(64)}','${'7'.repeat(64)}','rebuild-evidence','rebuild-verification','connection-claim:rebuild-operation');
INSERT INTO nexora_connection_events(id,connection_id,operation_id,tenant_id,workspace_id,event_type,from_state,to_state,connection_generation,fencing_token,detail_json) VALUES('rebuild-event','rebuild-preserved','rebuild-operation',7,8,'CONNECTION_REBUILD_PROOF','DISCOVERED','REAUTHORIZATION_REQUIRED',2,2,'{"preserved":true}');`);

const schemaRows = () => db.prepare(`SELECT type,name,sql FROM sqlite_master WHERE tbl_name IN ('nexora_connections','nexora_connection_operations','nexora_connection_events') AND type IN ('index','trigger') AND sql IS NOT NULL ORDER BY type,name`).all();
const normalizeSchema = (sql) => String(sql).replace(/\bIF NOT EXISTS\b/gi, '').replace(/\s+/g, ' ').trim();
const schemaBefore0082 = schemaRows();
db.exec(migration0082);
const preservedAfterFirstRebuild = {
	connection: db.prepare(`SELECT * FROM nexora_connections WHERE id='rebuild-preserved'`).get(),
	operation: db.prepare(`SELECT * FROM nexora_connection_operations WHERE id='rebuild-operation'`).get(),
	event: db.prepare(`SELECT * FROM nexora_connection_events WHERE id='rebuild-event'`).get(),
};
if (preservedAfterFirstRebuild.connection?.onboarding_mission_id !== 'mission-preserved'
	|| preservedAfterFirstRebuild.connection?.authority_generation !== 4
	|| preservedAfterFirstRebuild.operation?.evidence_id !== 'rebuild-evidence'
	|| preservedAfterFirstRebuild.event?.detail_json !== '{"preserved":true}') throw new Error('connection_owner_authority_populated_rebuild_failed');
if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('connection_owner_authority_foreign_key_rebuild_failed');

const schemaAfter0082 = schemaRows();
if (JSON.stringify(schemaAfter0082.map(({ type, name }) => ({ type, name }))) !== JSON.stringify(schemaBefore0082.map(({ type, name }) => ({ type, name })))) {
	throw new Error('connection_owner_authority_schema_object_set_changed');
}
const beforeByName = new Map(schemaBefore0082.map((row) => [row.name, normalizeSchema(row.sql)]));
for (const row of schemaAfter0082) {
	if (row.name === 'trg_nexora_connection_mission_association_guarded') continue;
	if (normalizeSchema(row.sql) !== beforeByName.get(row.name)) throw new Error(`connection_owner_authority_schema_drift:${row.name}`);
}
const connectionSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='nexora_connections'`).get().sql;
const operationSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='nexora_connection_operations'`).get().sql;
const missionTriggerSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_nexora_connection_mission_association_guarded'`).get().sql;
if (!/authority_generation\s*>=\s*0/.test(connectionSql)
	|| !/expected_authority_generation\s*>=\s*0/.test(operationSql)
	|| !/OLD\.state='REAUTHORIZATION_REQUIRED'/.test(missionTriggerSql)
	|| !/NEW\.state='AUTHORIZATION_PENDING'/.test(missionTriggerSql)) throw new Error('connection_owner_authority_schema_contract_missing');

db.exec(migration0082);
if (!db.prepare(`SELECT 1 AS ok FROM nexora_connections WHERE id='rebuild-preserved'`).get()?.ok
	|| !db.prepare(`SELECT 1 AS ok FROM nexora_connection_operations WHERE id='rebuild-operation'`).get()?.ok
	|| !db.prepare(`SELECT 1 AS ok FROM nexora_connection_events WHERE id='rebuild-event'`).get()?.ok) throw new Error('connection_owner_authority_repeated_rebuild_failed');
if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('connection_owner_authority_foreign_key_rebuild_failed');
db.exec(migration0083);
db.exec(migration0083);
const expiredMissionTriggerSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type='trigger' AND name='trg_nexora_connection_mission_association_guarded'`).get().sql;
if (!/julianday\(old_session\.expires_at\) IS NULL/.test(expiredMissionTriggerSql)
	|| !/replacement_session\.onboarding_mission_id=NEW\.onboarding_mission_id/.test(expiredMissionTriggerSql)
	|| !/replacement_operation\.authorization_session_id=replacement_session\.id/.test(expiredMissionTriggerSql)
	|| !/replacement_operation\.operation_type='REAUTHORIZE'/.test(expiredMissionTriggerSql)
	|| !/replacement_event\.id=NEW\.last_transition_event_id/.test(expiredMissionTriggerSql)
	|| !/OLD\.credential_reference_id IS NULL/.test(expiredMissionTriggerSql)) throw new Error('connection_expired_mission_rebind_contract_missing');
db.exec(`INSERT INTO nexora_onboarding_authorization_sessions(id,onboarding_mission_id,tenant_id,workspace_id,provider,status,created_at,expires_at) VALUES('session-expired-old','mission-expired-old',21,22,'google','pending',CURRENT_TIMESTAMP,'2020-01-01T00:00:00.000Z');
INSERT INTO nexora_onboarding_authorization_sessions(id,onboarding_mission_id,tenant_id,workspace_id,provider,status,created_at,expires_at) VALUES('session-expired-new','mission-expired-new',21,22,'google','pending',CURRENT_TIMESTAMP,'2999-01-01T00:00:00.000Z');
INSERT INTO nexora_connections(id,tenant_id,workspace_id,normalized_domain,domain_authority_id,domain_authority_generation,provider,account_id,onboarding_mission_id,state,authority_generation,lease_owner,lease_expires_at,fencing_token) VALUES('connection-expired-rebind',21,22,'expired.example','da-expired',1,'google',23,'mission-expired-old','DISCOVERED',0,'owner-expired','2999-01-01 00:00:00',11);
INSERT INTO mission_runtime_evidence VALUES('evidence-expired-rebind',21,22,'supported','{"operation_id":"operation-expired-rebind"}');
INSERT INTO mission_runtime_verifications VALUES('verification-expired-rebind','evidence-expired-rebind','connection-claim:operation-expired-rebind',21,22,'verified','valid','canonical_connection_policy_v1');
INSERT INTO nexora_connection_operations(id,connection_id,tenant_id,workspace_id,operation_type,idempotency_key,authorization_session_id,expected_authority_generation,expected_connection_generation,expected_credential_generation,lease_owner,lease_expires_at,fencing_token,transition_from_state,transition_to_state,state,request_digest,authority_tuple_digest,evidence_id,verification_id,claim_id) VALUES('operation-expired-rebind','connection-expired-rebind',21,22,'REAUTHORIZE','expired-rebind','session-expired-new',0,1,0,'owner-expired','2999-01-01 00:00:00',11,'DISCOVERED','AUTHORIZATION_PENDING','VERIFIED','${'a'.repeat(64)}','${'b'.repeat(64)}','evidence-expired-rebind','verification-expired-rebind','connection-claim:operation-expired-rebind');
INSERT INTO nexora_connection_events(id,connection_id,operation_id,tenant_id,workspace_id,event_type,from_state,to_state,connection_generation,fencing_token) VALUES('event-expired-rebind','connection-expired-rebind','operation-expired-rebind',21,22,'CONNECTION_AUTHORIZATION_SESSION_BOUND','DISCOVERED','AUTHORIZATION_PENDING',2,11);
UPDATE nexora_connections SET state='AUTHORIZATION_PENDING',onboarding_mission_id='mission-expired-new',connection_generation=2,last_transition_event_id='event-expired-rebind' WHERE id='connection-expired-rebind';`);
const expiredRebound = db.prepare(`SELECT state,onboarding_mission_id FROM nexora_connections WHERE id='connection-expired-rebind'`).get();
if (expiredRebound.state !== 'AUTHORIZATION_PENDING' || expiredRebound.onboarding_mission_id !== 'mission-expired-new') throw new Error('connection_expired_mission_rebind_failed');
db.exec(`INSERT INTO nexora_onboarding_authorization_sessions(id,onboarding_mission_id,tenant_id,workspace_id,provider,status,created_at,expires_at) VALUES('session-mismatch-old','mission-mismatch-old',31,32,'google','pending',CURRENT_TIMESTAMP,'2020-01-01T00:00:00.000Z');
INSERT INTO nexora_onboarding_authorization_sessions(id,onboarding_mission_id,tenant_id,workspace_id,provider,status,created_at,expires_at) VALUES('session-mismatch-target','mission-mismatch-target',31,32,'google','pending',CURRENT_TIMESTAMP,'2999-01-01T00:00:00.000Z');
INSERT INTO nexora_onboarding_authorization_sessions(id,onboarding_mission_id,tenant_id,workspace_id,provider,status,created_at,expires_at) VALUES('session-mismatch-operation','mission-other',31,32,'google','pending',CURRENT_TIMESTAMP,'2999-01-01T00:00:00.000Z');
INSERT INTO nexora_connections(id,tenant_id,workspace_id,normalized_domain,domain_authority_id,domain_authority_generation,provider,account_id,onboarding_mission_id,state,authority_generation,lease_owner,lease_expires_at,fencing_token) VALUES('connection-mismatch',31,32,'mismatch.example','da-mismatch',1,'google',33,'mission-mismatch-old','DISCOVERED',0,'owner-mismatch','2999-01-01 00:00:00',12);
INSERT INTO mission_runtime_evidence VALUES('evidence-mismatch',31,32,'supported','{"operation_id":"operation-mismatch"}');
INSERT INTO mission_runtime_verifications VALUES('verification-mismatch','evidence-mismatch','connection-claim:operation-mismatch',31,32,'verified','valid','canonical_connection_policy_v1');
INSERT INTO nexora_connection_operations(id,connection_id,tenant_id,workspace_id,operation_type,idempotency_key,authorization_session_id,expected_authority_generation,expected_connection_generation,expected_credential_generation,lease_owner,lease_expires_at,fencing_token,transition_from_state,transition_to_state,state,request_digest,authority_tuple_digest,evidence_id,verification_id,claim_id) VALUES('operation-mismatch','connection-mismatch',31,32,'REAUTHORIZE','mismatch','session-mismatch-operation',0,1,0,'owner-mismatch','2999-01-01 00:00:00',12,'DISCOVERED','AUTHORIZATION_PENDING','VERIFIED','${'c'.repeat(64)}','${'d'.repeat(64)}','evidence-mismatch','verification-mismatch','connection-claim:operation-mismatch');
INSERT INTO nexora_connection_events(id,connection_id,operation_id,tenant_id,workspace_id,event_type,from_state,to_state,connection_generation,fencing_token) VALUES('event-mismatch','connection-mismatch','operation-mismatch',31,32,'CONNECTION_AUTHORIZATION_SESSION_BOUND','DISCOVERED','AUTHORIZATION_PENDING',2,12);`);
mustReject('mismatched replacement session', () => db.exec(`UPDATE nexora_connections SET state='AUTHORIZATION_PENDING',onboarding_mission_id='mission-mismatch-target',connection_generation=2,last_transition_event_id='event-mismatch' WHERE id='connection-mismatch'`), 'mission_association_invalid');

function mustReject(name, action, expected) {
	try { action(); throw new Error(`${name}:accepted`); }
	catch (error) { if (!String(error.message).includes(expected)) throw error; }
}

mustReject('initial healthy', () => db.exec(`INSERT INTO nexora_connections(id,tenant_id,workspace_id,normalized_domain,domain_authority_id,domain_authority_generation,provider,account_id,state,authority_generation) VALUES('bad',1,1,'example.com','da',1,'google',1,'HEALTHY',1)`), 'initial_state_must_be_discovered');

db.exec(`INSERT INTO nexora_connections(id,tenant_id,workspace_id,normalized_domain,domain_authority_id,domain_authority_generation,provider,account_id,state,authority_generation,lease_owner,lease_expires_at,fencing_token) VALUES('connection-owner',1,1,'example.com','da-owner',1,'google',1,'DISCOVERED',0,'owner-zero','2999-01-01 00:00:00',1);
INSERT INTO mission_runtime_evidence VALUES('evidence-owner',1,1,'supported','{"operation_id":"operation-owner"}');
INSERT INTO mission_runtime_verifications VALUES('verification-owner','evidence-owner','connection-claim:operation-owner',1,1,'verified','valid','canonical_connection_policy_v1');
INSERT INTO nexora_connection_operations(id,connection_id,tenant_id,workspace_id,operation_type,idempotency_key,authorization_session_id,expected_authority_generation,expected_connection_generation,expected_credential_generation,lease_owner,lease_expires_at,fencing_token,transition_from_state,transition_to_state,state,request_digest,authority_tuple_digest,evidence_id,verification_id,claim_id) VALUES('operation-owner','connection-owner',1,1,'REAUTHORIZE','owner-zero','session-owner',0,1,0,'owner-zero','2999-01-01 00:00:00',1,'DISCOVERED','AUTHORIZATION_PENDING','VERIFIED','${'4'.repeat(64)}','${'5'.repeat(64)}','evidence-owner','verification-owner','connection-claim:operation-owner');
INSERT INTO nexora_connection_events(id,connection_id,operation_id,tenant_id,workspace_id,event_type,from_state,to_state,connection_generation,fencing_token) VALUES('event-owner','connection-owner','operation-owner',1,1,'CONNECTION_AUTHORIZATION_SESSION_BOUND','DISCOVERED','AUTHORIZATION_PENDING',2,1);
UPDATE nexora_connections SET state='AUTHORIZATION_PENDING',onboarding_mission_id='mission-owner',connection_generation=2,last_transition_event_id='event-owner' WHERE id='connection-owner';`);
const ownerConnection = db.prepare(`SELECT state,authority_generation,onboarding_mission_id FROM nexora_connections WHERE id='connection-owner'`).get();
if (ownerConnection.state !== 'AUTHORIZATION_PENDING' || ownerConnection.authority_generation !== 0 || ownerConnection.onboarding_mission_id !== 'mission-owner') throw new Error('canonical_owner_generation_zero_transition_failed');
mustReject('unfenced owner mission rebind', () => db.exec(`UPDATE nexora_connections SET onboarding_mission_id='mission-owner-other' WHERE id='connection-owner'`), 'mission_association_invalid');

db.exec(`INSERT INTO nexora_connections(id,tenant_id,workspace_id,normalized_domain,domain_authority_id,domain_authority_generation,provider,account_id,state,authority_generation,lease_owner,lease_expires_at,fencing_token) VALUES('connection-untrusted',1,2,'example.com','da-2',1,'google',4,'DISCOVERED',4,'owner-u','2999-01-01 00:00:00',6);
INSERT INTO mission_runtime_evidence VALUES('evidence-untrusted',1,2,'supported','{"operation_id":"operation-untrusted"}');
INSERT INTO mission_runtime_verifications VALUES('verification-untrusted','evidence-untrusted','connection-claim:operation-untrusted',1,2,'verified','valid','connection_contract_v1');
INSERT INTO nexora_connection_operations(id,connection_id,tenant_id,workspace_id,operation_type,idempotency_key,expected_authority_generation,expected_connection_generation,expected_credential_generation,lease_owner,lease_expires_at,fencing_token,transition_from_state,transition_to_state,state,request_digest,authority_tuple_digest,evidence_id,verification_id,claim_id) VALUES('operation-untrusted','connection-untrusted',1,2,'DISCOVER','discover-untrusted',4,1,0,'owner-u','2999-01-01 00:00:00',6,'DISCOVERED','REAUTHORIZATION_REQUIRED','VERIFIED','${'8'.repeat(64)}','${'9'.repeat(64)}','evidence-untrusted','verification-untrusted','connection-claim:operation-untrusted');
INSERT INTO nexora_connection_events(id,connection_id,operation_id,tenant_id,workspace_id,event_type,from_state,to_state,connection_generation,fencing_token) VALUES('event-untrusted','connection-untrusted','operation-untrusted',1,2,'CONNECTION_UNTRUSTED','DISCOVERED','REAUTHORIZATION_REQUIRED',2,6);`);
mustReject('self asserted verification', () => db.exec(`UPDATE nexora_connections SET state='REAUTHORIZATION_REQUIRED',connection_generation=2,last_transition_event_id='event-untrusted' WHERE id='connection-untrusted'`), 'transition_authority_required');

db.exec(`INSERT INTO nexora_connections(id,tenant_id,workspace_id,normalized_domain,domain_authority_id,domain_authority_generation,provider,account_id,state,authority_generation,lease_owner,lease_expires_at,fencing_token) VALUES('connection-1',1,2,'example.com','da-1',1,'google',3,'DISCOVERED',4,'owner-1','2999-01-01 00:00:00',5);
INSERT INTO mission_runtime_evidence VALUES('evidence-1',1,2,'supported','{"operation_id":"operation-1"}');
INSERT INTO mission_runtime_verifications VALUES('verification-1','evidence-1','connection-claim:operation-1',1,2,'verified','valid','canonical_connection_policy_v1');
INSERT INTO nexora_connection_operations(id,connection_id,tenant_id,workspace_id,operation_type,idempotency_key,expected_authority_generation,expected_connection_generation,expected_credential_generation,lease_owner,lease_expires_at,fencing_token,transition_from_state,transition_to_state,state,request_digest,authority_tuple_digest,evidence_id,verification_id,claim_id) VALUES('operation-1','connection-1',1,2,'DISCOVER','discover-1',4,1,0,'owner-1','2999-01-01 00:00:00',5,'DISCOVERED','REAUTHORIZATION_REQUIRED','VERIFIED','${'0'.repeat(64)}','${'1'.repeat(64)}','evidence-1','verification-1','connection-claim:operation-1');
INSERT INTO nexora_connection_events(id,connection_id,operation_id,tenant_id,workspace_id,event_type,from_state,to_state,connection_generation,fencing_token) VALUES('event-1','connection-1','operation-1',1,2,'CONNECTION_REAUTHORIZATION_REQUIRED','DISCOVERED','REAUTHORIZATION_REQUIRED',2,5);
UPDATE nexora_connections SET state='REAUTHORIZATION_REQUIRED',connection_generation=2,last_transition_event_id='event-1' WHERE id='connection-1';`);

const transitioned = db.prepare(`SELECT state,connection_generation,last_transition_event_id FROM nexora_connections WHERE id='connection-1'`).get();
if (transitioned.state !== 'REAUTHORIZATION_REQUIRED' || transitioned.connection_generation !== 2 || transitioned.last_transition_event_id !== 'event-1') throw new Error('valid_transition_failed');

mustReject('event update', () => db.exec(`UPDATE nexora_connection_events SET detail_json='{"rewritten":true}' WHERE id='event-1'`), 'events_immutable');
mustReject('event delete', () => db.exec(`DELETE FROM nexora_connection_events WHERE id='event-1'`), 'events_immutable');
mustReject('illegal transition', () => db.exec(`UPDATE nexora_connections SET state='HEALTHY',connection_generation=3 WHERE id='connection-1'`), 'nexora_connection_');
mustReject('cross tenant operation', () => db.exec(`INSERT INTO nexora_connection_operations(id,connection_id,tenant_id,workspace_id,operation_type,idempotency_key,expected_authority_generation,expected_connection_generation,expected_credential_generation,state,request_digest,authority_tuple_digest) VALUES('cross','connection-1',999,2,'DISCOVER','cross',4,2,0,'PENDING','${'2'.repeat(64)}','${'3'.repeat(64)}')`), 'FOREIGN KEY');

db.exec(`INSERT INTO nexora_onboarding_refresh_work(id) VALUES('refresh-work-1');
INSERT INTO nexora_connection_refresh_attempts(id,refresh_work_id,tenant_id,workspace_id,provider,expected_token_generation,fencing_token) VALUES('attempt-1','refresh-work-1',1,2,'google',1,1);
UPDATE nexora_connection_refresh_attempts SET provider_request_started_at=CURRENT_TIMESTAMP WHERE id='attempt-1';
UPDATE nexora_connection_refresh_attempts SET provider_response_observed_at=CURRENT_TIMESTAMP,terminal_classification='SUCCESS_OBSERVED' WHERE id='attempt-1';`);
mustReject('refresh attempt delete', () => db.exec(`DELETE FROM nexora_connection_refresh_attempts WHERE id='attempt-1'`), 'refresh_attempt_immutable');
mustReject('refresh attempt rewrite', () => db.exec(`UPDATE nexora_connection_refresh_attempts SET terminal_classification='REWRITTEN' WHERE id='attempt-1'`), 'refresh_attempt_update_invalid');

db.exec(`INSERT INTO nexora_onboarding_refresh_work(id) VALUES('refresh-work-ambiguous');
INSERT INTO nexora_connection_refresh_attempts(id,refresh_work_id,tenant_id,workspace_id,provider,expected_token_generation,fencing_token) VALUES('attempt-ambiguous','refresh-work-ambiguous',1,2,'google',1,1);
UPDATE nexora_connection_refresh_attempts SET provider_request_started_at=CURRENT_TIMESTAMP WHERE id='attempt-ambiguous';
UPDATE nexora_connection_refresh_attempts SET terminal_classification='OUTCOME_AMBIGUOUS' WHERE id='attempt-ambiguous';`);
mustReject('ambiguous attempt rewrite', () => db.exec(`UPDATE nexora_connection_refresh_attempts SET provider_response_observed_at=CURRENT_TIMESTAMP,terminal_classification='SUCCESS_OBSERVED' WHERE id='attempt-ambiguous'`), 'refresh_attempt_update_invalid');

db.exec(`INSERT INTO nexora_callback_verified_results(id,authorization_session_id,result_status) VALUES('verified-result-1','authorization-session-1','VERIFIED')`);
mustReject('verified result identity update', () => db.exec(`UPDATE nexora_callback_verified_results SET authorization_session_id='authorization-session-2' WHERE id='verified-result-1'`), 'verified_result_immutable');
mustReject('verified result delete', () => db.exec(`DELETE FROM nexora_callback_verified_results WHERE id='verified-result-1'`), 'verified_result_immutable');

db.exec(`INSERT INTO nexora_onboarding_authorization_sessions VALUES('authorization-session-1','mission-1',1,2,'google','first_party','redirect-1','["openid"]','[]','state-hash','nonce-hash','challenge','S256','verifier-hash','tenant-hint','login-hash','pending',CURRENT_TIMESTAMP,'2999-01-01 00:00:00',NULL,NULL,NULL);
UPDATE nexora_onboarding_authorization_sessions SET status='consumed',consumed_at=CURRENT_TIMESTAMP,callback_fingerprint='callback-hash',resume_checkpoint='resume-1' WHERE id='authorization-session-1';`);
mustReject('authorization login identity update', () => db.exec(`UPDATE nexora_onboarding_authorization_sessions SET login_hint_hash='other-login-hash' WHERE id='authorization-session-1'`), 'authorization_session_identity_immutable');
mustReject('authorization session delete', () => db.exec(`DELETE FROM nexora_onboarding_authorization_sessions WHERE id='authorization-session-1'`), 'authorization_session_immutable');

console.log('PASS_CONNECTION_RUNTIME_SQLITE_INTEGRITY');
