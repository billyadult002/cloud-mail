import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const db = new DatabaseSync(':memory:');
db.exec(`
PRAGMA foreign_keys=ON;
CREATE TABLE nexora_onboarding_authorization_sessions (
 id TEXT PRIMARY KEY,onboarding_mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,status TEXT
);
CREATE TABLE nexora_onboarding_callback_correlations (
 id TEXT PRIMARY KEY,authorization_session_id TEXT,onboarding_mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT
);
CREATE TABLE nexora_onboarding_callback_claims (
 id TEXT PRIMARY KEY,authorization_session_id TEXT,correlation_id TEXT,onboarding_mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,
 lease_owner TEXT,lease_expires_at TEXT,fencing_token INTEGER,claim_status TEXT,recovery_mode TEXT
);
CREATE TABLE nexora_connections (
 id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,connection_generation INTEGER,authority_generation INTEGER,state TEXT,
 account_id INTEGER,domain_authority_id TEXT,domain_authority_generation INTEGER,provider_connection_id TEXT,provider_connection_generation INTEGER,
 credential_reference_id TEXT,credential_generation INTEGER,onboarding_mission_id TEXT,last_transition_event_id TEXT
);
CREATE TABLE workspaces(id INTEGER PRIMARY KEY,tenant_key TEXT NOT NULL);
CREATE TABLE workspace_members(workspace_id INTEGER,user_id INTEGER,role TEXT,PRIMARY KEY(workspace_id,user_id));
CREATE TABLE account(account_id INTEGER PRIMARY KEY,user_id INTEGER,is_del INTEGER NOT NULL DEFAULT 0);
CREATE TABLE nexora_domain_authorities(
 id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,generation INTEGER,verification_status TEXT,revoked_at TEXT
);
CREATE TABLE workspace_membership_authorities(
 id TEXT PRIMARY KEY,tenant_key TEXT,workspace_id INTEGER,subject_user_id INTEGER,state TEXT,authority_generation INTEGER,expires_at TEXT
);
CREATE TABLE workspace_account_delegations(
 id TEXT PRIMARY KEY,tenant_key TEXT,workspace_id INTEGER,account_id INTEGER,owner_user_id INTEGER,subject_user_id INTEGER,
 scope_json TEXT,state TEXT,authority_generation INTEGER,owner_consent_at TEXT,approved_at TEXT,expires_at TEXT
);
CREATE TABLE nexora_connection_operations (
 id TEXT PRIMARY KEY,connection_id TEXT,tenant_id INTEGER,workspace_id INTEGER,operation_type TEXT,
 callback_correlation_id TEXT,expected_connection_generation INTEGER,state TEXT
);
CREATE TABLE nexora_connection_events (
 id TEXT PRIMARY KEY,connection_id TEXT,operation_id TEXT,tenant_id INTEGER,workspace_id INTEGER
);
CREATE TABLE nexora_callback_verified_results (
 id TEXT PRIMARY KEY,mission_id TEXT,authorization_session_id TEXT,callback_correlation_id TEXT,tenant_id INTEGER,
 workspace_id INTEGER,provider TEXT,result_status TEXT,provider_connection_id TEXT,provider_connection_generation INTEGER,token_generation INTEGER
);
CREATE TABLE nexora_onboarding_token_connection_bindings (
 token_id TEXT,connection_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,connection_generation INTEGER,token_generation INTEGER
);
`);
const migration = fs.readFileSync(path.resolve(import.meta.dirname, '../migrations/0084_nexora_oauth_confidential_exchange_recovery.sql'), 'utf8');
db.exec(migration);
db.exec(migration);

db.exec(`
INSERT INTO nexora_onboarding_authorization_sessions VALUES('session-1','mission-1',1,2,'google','consumed');
INSERT INTO nexora_onboarding_callback_correlations VALUES('correlation-1','session-1','mission-1',1,2,'google');
INSERT INTO nexora_onboarding_callback_claims VALUES('claim-1','session-1','correlation-1','mission-1',1,2,'google','owner-1','2027-01-01',1,'CLAIMED','EXECUTION');
INSERT INTO workspaces VALUES(2,'user:1');
INSERT INTO workspace_members VALUES(2,1,'OWNER');
INSERT INTO account VALUES(42,1,0);
INSERT INTO nexora_domain_authorities VALUES('domain-1',1,2,1,'verified',NULL);
INSERT INTO nexora_connections(
 id,tenant_id,workspace_id,connection_generation,authority_generation,state,account_id,domain_authority_id,
 domain_authority_generation,provider_connection_id,provider_connection_generation,credential_reference_id,credential_generation,onboarding_mission_id
) VALUES('connection-1',1,2,8,0,'AUTHORIZATION_PENDING',42,'domain-1',1,NULL,0,NULL,0,'mission-1');
INSERT INTO nexora_oauth_authorization_session_bindings(
 authorization_session_id,onboarding_mission_id,tenant_id,workspace_id,provider,runtime_mode,connection_id,connection_generation,
 authority_generation,account_id,account_owner_user_id,domain_authority_id,domain_authority_generation,authority_kind,
 redirect_uri_hash,oauth_client_fingerprint,scope_manifest_version,
 scope_manifest_digest,issued_at,expires_at
) VALUES('session-1','mission-1',1,2,'google','CONNECTION_RUNTIME','connection-1',8,0,42,1,'domain-1',1,'ACCOUNT_OWNER',
 'redirect','client','manifest-v1','manifest','2026-01-01','2027-01-01');
`);

db.exec(`
INSERT INTO nexora_onboarding_authorization_sessions VALUES('legacy-session','legacy-mission',1,2,'google','consumed');
INSERT INTO nexora_onboarding_callback_correlations VALUES('legacy-correlation','legacy-session','legacy-mission',1,2,'google');
INSERT INTO nexora_onboarding_callback_claims VALUES('legacy-claim','legacy-session','legacy-correlation','legacy-mission',1,2,'google','legacy-owner','2027-01-01',2,'CLAIMED','EXECUTION');
INSERT INTO nexora_oauth_authorization_session_bindings(
 authorization_session_id,onboarding_mission_id,tenant_id,workspace_id,provider,runtime_mode,
 redirect_uri_hash,oauth_client_fingerprint,scope_manifest_version,scope_manifest_digest,issued_at,expires_at
) VALUES('legacy-session','legacy-mission',1,2,'google','LEGACY','legacy-redirect','legacy-client','manifest-v1','legacy-manifest','2026-01-01','2027-01-01');
INSERT INTO nexora_oauth_exchange_attempts(
 id,authorization_session_id,callback_correlation_id,callback_claim_id,onboarding_mission_id,tenant_id,workspace_id,
 provider,connection_id,expected_connection_generation,expected_authority_generation,exchange_owner,lease_expires_at,
 fencing_token,idempotency_key,request_digest,state
) VALUES('legacy-attempt','legacy-session','legacy-correlation','legacy-claim','legacy-mission',1,2,'google',NULL,NULL,NULL,'legacy-owner','2027-01-01',2,'legacy-attempt-key','legacy-request-digest','EXCHANGE_IN_PROGRESS');
`);
if (!db.prepare(`SELECT id FROM nexora_oauth_exchange_attempts WHERE id='legacy-attempt'`).get()) {
	throw new Error('runtime-disabled legacy exchange was rejected by production migration semantics');
}

const insertAttempt = (tenant = 1) => db.prepare(`
 INSERT INTO nexora_oauth_exchange_attempts(
  id,authorization_session_id,callback_correlation_id,callback_claim_id,onboarding_mission_id,tenant_id,workspace_id,
  provider,connection_id,expected_connection_generation,expected_authority_generation,exchange_owner,lease_expires_at,
  fencing_token,idempotency_key,request_digest,state
 ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
`).run(
	'attempt-1', 'session-1', 'correlation-1', 'claim-1', 'mission-1', tenant, 2,
	'google', 'connection-1', 8, 0, 'owner-1', '2027-01-01', 1, 'attempt-key-1', 'request-digest', 'EXCHANGE_IN_PROGRESS',
);

let crossScopeRejected = false;
try { insertAttempt(99); } catch (error) { crossScopeRejected = String(error.message).includes('nexora_oauth_exchange_tuple_invalid'); }
if (!crossScopeRejected) throw new Error('cross-scope exchange tuple was accepted');

db.exec(`UPDATE nexora_onboarding_callback_claims SET lease_expires_at='2020-01-01' WHERE id='claim-1'`);
let expiredClaimRejected = false;
try { insertAttempt(1); } catch (error) { expiredClaimRejected = String(error.message).includes('nexora_oauth_exchange_tuple_invalid'); }
if (!expiredClaimRejected) throw new Error('expired exchange claim was accepted');
db.exec(`UPDATE nexora_onboarding_callback_claims SET lease_expires_at='2027-01-01' WHERE id='claim-1'`);

db.exec(`UPDATE nexora_connections SET connection_generation=9 WHERE id='connection-1'`);
let staleConnectionRejected = false;
try { insertAttempt(1); } catch (error) { staleConnectionRejected = String(error.message).includes('nexora_oauth_exchange_tuple_invalid'); }
if (!staleConnectionRejected) throw new Error('stale connection generation was accepted');
db.exec(`UPDATE nexora_connections SET connection_generation=8 WHERE id='connection-1'`);

db.exec(`UPDATE account SET is_del=1 WHERE account_id=42`);
let deletedAccountRejected = false;
try { insertAttempt(1); } catch (error) { deletedAccountRejected = String(error.message).includes('nexora_oauth_exchange_tuple_invalid'); }
if (!deletedAccountRejected) throw new Error('exchange accepted a deleted live account');
db.exec(`UPDATE account SET is_del=0 WHERE account_id=42`);

db.exec(`UPDATE nexora_domain_authorities SET verification_status='revoked',revoked_at=CURRENT_TIMESTAMP,generation=2 WHERE id='domain-1'`);
let revokedDomainRejected = false;
try { insertAttempt(1); } catch (error) { revokedDomainRejected = String(error.message).includes('nexora_oauth_exchange_tuple_invalid'); }
if (!revokedDomainRejected) throw new Error('exchange accepted a revoked live Domain Authority');
db.exec(`UPDATE nexora_domain_authorities SET verification_status='verified',revoked_at=NULL,generation=1 WHERE id='domain-1'`);

db.exec(`
UPDATE workspaces SET tenant_key='org:fixture' WHERE id=2;
UPDATE account SET user_id=99 WHERE account_id=42;
INSERT INTO workspace_membership_authorities VALUES('membership-1','org:fixture',2,1,'active',4,'2027-01-01');
INSERT INTO workspace_account_delegations VALUES('delegation-1','org:fixture',2,42,99,1,'["account_state_visibility"]','active',3,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'2027-01-01');
UPDATE nexora_oauth_authorization_session_bindings
 SET authority_generation=3,account_owner_user_id=99,authority_kind='ACCOUNT_DELEGATION',
     membership_authority_id='membership-1',membership_authority_generation=4,
     delegation_authority_id='delegation-1',delegation_authority_generation=3
 WHERE authorization_session_id='session-1';
UPDATE nexora_connections SET authority_generation=3 WHERE id='connection-1';
UPDATE workspace_account_delegations SET state='revoked',authority_generation=4 WHERE id='delegation-1';
`);
let revokedDelegationRejected = false;
try {
	insertAttempt(1);
} catch (error) {
	revokedDelegationRejected = String(error.message).includes('nexora_oauth_exchange_tuple_invalid');
}
if (!revokedDelegationRejected) throw new Error('exchange accepted a revoked live delegation');
db.exec(`
DELETE FROM workspace_account_delegations;
DELETE FROM workspace_membership_authorities;
UPDATE workspaces SET tenant_key='user:1' WHERE id=2;
UPDATE account SET user_id=1 WHERE account_id=42;
UPDATE nexora_oauth_authorization_session_bindings
 SET authority_generation=0,account_owner_user_id=1,authority_kind='ACCOUNT_OWNER',
     membership_authority_id=NULL,membership_authority_generation=NULL,
     delegation_authority_id=NULL,delegation_authority_generation=NULL
 WHERE authorization_session_id='session-1';
UPDATE nexora_connections SET authority_generation=0 WHERE id='connection-1';
`);

insertAttempt(1);

db.exec(`UPDATE account SET is_del=1 WHERE account_id=42`);
let revokedDuringExchangeSealRejected = false;
try {
	db.exec(`UPDATE nexora_oauth_exchange_attempts SET receipt_ciphertext='ciphertext',receipt_digest='digest',receipt_expires_at='2027-01-01',state='EXCHANGE_SUCCEEDED_COMMIT_PENDING' WHERE id='attempt-1'`);
} catch (error) {
	revokedDuringExchangeSealRejected = String(error.message).includes('nexora_oauth_exchange_seal_live_authority_missing');
}
if (!revokedDuringExchangeSealRejected) throw new Error('provider response sealed after live authority revocation');
db.exec(`UPDATE account SET is_del=0 WHERE account_id=42`);

db.exec(`UPDATE nexora_oauth_exchange_attempts SET receipt_ciphertext='ciphertext',receipt_digest='digest',receipt_expires_at='2027-01-01',state='EXCHANGE_SUCCEEDED_COMMIT_PENDING' WHERE id='attempt-1'`);
db.exec(`UPDATE nexora_oauth_exchange_attempts SET credential_reference_id='credential-1',state='CREDENTIAL_STORED_CONNECTION_PENDING' WHERE id='attempt-1'`);
db.exec(`UPDATE nexora_oauth_exchange_attempts SET provider_connection_id='provider-connection-1',provider_connection_generation=1,state='CONNECTION_COMMITTED_VERIFICATION_PENDING' WHERE id='attempt-1'`);

db.exec(`
INSERT INTO nexora_connection_operations(id,connection_id,tenant_id,workspace_id,operation_type,callback_correlation_id,expected_connection_generation,state)
VALUES('callback-op-1','connection-1',1,2,'CALLBACK','correlation-1',8,'VERIFIED');
INSERT INTO nexora_connection_events VALUES('callback-event-1','connection-1','callback-op-1',1,2);
`);
let unverifiedConnectionTransitionRejected = false;
try {
	db.exec(`UPDATE nexora_connections SET state='CONNECTED',connection_generation=9,last_transition_event_id='callback-event-1',provider_connection_id='provider-connection-1',provider_connection_generation=1,credential_reference_id='credential-1',credential_generation=1 WHERE id='connection-1'`);
} catch (error) {
	unverifiedConnectionTransitionRejected = String(error.message).includes('nexora_oauth_callback_connection_live_authority_missing');
}
if (!unverifiedConnectionTransitionRejected) throw new Error('Connection transitioned to CONNECTED without exact verified exchange tuple');

let evidenceGateRejected = false;
try { db.exec(`UPDATE nexora_oauth_exchange_attempts SET state='CALLBACK_VERIFIED' WHERE id='attempt-1'`); } catch (error) { evidenceGateRejected = String(error.message).includes('nexora_oauth_exchange_verified_authority_missing'); }
if (!evidenceGateRejected) throw new Error('callback verified without canonical authority');

db.exec(`
INSERT INTO nexora_onboarding_token_connection_bindings VALUES('credential-1','provider-connection-1',1,2,'google',1,1);
UPDATE nexora_connections SET authority_generation=1 WHERE id='connection-1';
`);
let staleVerifiedAuthorityRejected = false;
try {
	db.exec(`INSERT INTO nexora_callback_verified_results VALUES('verified-stale','mission-1','session-1','correlation-1',1,2,'google','VERIFIED','provider-connection-1',1,1)`);
} catch (error) {
	staleVerifiedAuthorityRejected = String(error.message).includes('nexora_oauth_verified_result_live_authority_missing');
}
if (!staleVerifiedAuthorityRejected) throw new Error('verified callback result accepted stale Connection authority');
db.exec(`
UPDATE nexora_connections SET authority_generation=0 WHERE id='connection-1';
UPDATE nexora_domain_authorities SET verification_status='revoked',revoked_at=CURRENT_TIMESTAMP,generation=2 WHERE id='domain-1';
`);
let revokedDomainFinalizationRejected = false;
try {
	db.exec(`INSERT INTO nexora_callback_verified_results VALUES('verified-domain-revoked','mission-1','session-1','correlation-1',1,2,'google','VERIFIED','provider-connection-1',1,1)`);
} catch (error) {
	revokedDomainFinalizationRejected = String(error.message).includes('nexora_oauth_verified_result_live_authority_missing');
}
if (!revokedDomainFinalizationRejected) throw new Error('verified callback result accepted revoked live Domain Authority');
db.exec(`
UPDATE nexora_domain_authorities SET verification_status='verified',revoked_at=NULL,generation=1 WHERE id='domain-1';
INSERT INTO nexora_callback_verified_results VALUES('verified-1','mission-1','session-1','correlation-1',1,2,'google','VERIFIED','provider-connection-1',1,1);
UPDATE account SET is_del=1 WHERE account_id=42;
`);
let revokedConnectionTransitionRejected = false;
try {
	db.exec(`UPDATE nexora_connections SET state='CONNECTED',connection_generation=9,last_transition_event_id='callback-event-1',provider_connection_id='provider-connection-1',provider_connection_generation=1,credential_reference_id='credential-1',credential_generation=1 WHERE id='connection-1'`);
} catch (error) {
	revokedConnectionTransitionRejected = String(error.message).includes('nexora_oauth_callback_connection_live_authority_missing');
}
if (!revokedConnectionTransitionRejected) throw new Error('Connection transitioned to CONNECTED after live authority revocation');
db.exec(`
UPDATE account SET is_del=0 WHERE account_id=42;
UPDATE nexora_oauth_exchange_attempts SET state='CALLBACK_VERIFIED' WHERE id='attempt-1';
`);
const terminal = db.prepare(`SELECT state FROM nexora_oauth_exchange_attempts WHERE id='attempt-1'`).get();
if (terminal.state !== 'CALLBACK_VERIFIED') throw new Error('verified transition did not commit');
console.log('PASS_OAUTH_REMEDIATION_SQLITE_INTEGRITY');
