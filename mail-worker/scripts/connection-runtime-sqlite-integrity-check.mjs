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
const migration = readFileSync(new URL('../migrations/0081_nexora_durable_connection_runtime.sql', import.meta.url), 'utf8');
db.exec(migration);
db.exec(migration);

function mustReject(name, action, expected) {
	try { action(); throw new Error(`${name}:accepted`); }
	catch (error) { if (!String(error.message).includes(expected)) throw error; }
}

mustReject('initial healthy', () => db.exec(`INSERT INTO nexora_connections(id,tenant_id,workspace_id,normalized_domain,domain_authority_id,domain_authority_generation,provider,account_id,state,authority_generation) VALUES('bad',1,1,'example.com','da',1,'google',1,'HEALTHY',1)`), 'initial_state_must_be_discovered');

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
