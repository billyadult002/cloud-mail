import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import tokenStorage from '../../src/service/nexora-onboarding-token-storage-service.js';
import providerSession from '../../src/service/provider-session-service.js';

const scope={tenantId:77101,workspaceId:77102};
const context={env:{...env,AI_PROVIDER_TOKEN_SECRET:'provider-session-test-secret-1234'}};
const tables=['nexora_connection_operations','nexora_connections','nexora_onboarding_token_connection_bindings','nexora_onboarding_provider_connections','nexora_onboarding_tokens'];
const schema=[
	`CREATE TABLE nexora_onboarding_tokens(id TEXT PRIMARY KEY,onboarding_mission_id TEXT UNIQUE,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,provider_account_hash TEXT,refresh_token_ciphertext TEXT,access_token_ciphertext TEXT,access_token_expires_at TEXT,granted_scopes_json TEXT,rotation_generation INTEGER DEFAULT 1,connection_health TEXT DEFAULT 'healthy',revoked_at TEXT,revoked_reason TEXT,refresh_failure_count INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE nexora_onboarding_provider_connections(id TEXT PRIMARY KEY,onboarding_mission_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,generation INTEGER,connection_state TEXT)`,
	`CREATE TABLE nexora_onboarding_token_connection_bindings(token_id TEXT PRIMARY KEY,connection_id TEXT,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,token_generation INTEGER,connection_generation INTEGER)`,
	`CREATE TABLE nexora_connections(id TEXT PRIMARY KEY,tenant_id INTEGER,workspace_id INTEGER,provider TEXT,account_id INTEGER,onboarding_mission_id TEXT,provider_connection_id TEXT,provider_connection_generation INTEGER,credential_reference_id TEXT,credential_generation INTEGER,state TEXT,connection_generation INTEGER,provider_session_generation INTEGER DEFAULT 0,lease_owner TEXT,lease_expires_at TEXT,fencing_token INTEGER,updated_at TEXT DEFAULT CURRENT_TIMESTAMP)`,
	`CREATE TABLE nexora_connection_operations(id TEXT PRIMARY KEY,connection_id TEXT,tenant_id INTEGER,workspace_id INTEGER,operation_type TEXT,state TEXT,lease_owner TEXT,lease_expires_at TEXT,fencing_token INTEGER)`,
];

beforeEach(async()=>{
	await env.db.batch(tables.map((table)=>env.db.prepare(`DROP TABLE IF EXISTS ${table}`)));
	for(const sql of schema) await env.db.prepare(sql).run();
	await tokenStorage.storeTokens(context,scope,{onboardingMissionId:'mission-1',provider:'google',providerAccountHash:'account-hash',refreshToken:'refresh-secret',accessToken:'access-secret',accessTokenExpiresAt:new Date(Date.now()+3600000).toISOString(),grantedScopes:['https://www.googleapis.com/auth/gmail.readonly']});
	const token=await env.db.prepare(`SELECT id,rotation_generation FROM nexora_onboarding_tokens WHERE onboarding_mission_id='mission-1'`).first();
	await env.db.batch([
		env.db.prepare(`INSERT INTO nexora_onboarding_provider_connections VALUES('provider-1','mission-1',?1,?2,'google',1,'active')`).bind(scope.tenantId,scope.workspaceId),
		env.db.prepare(`INSERT INTO nexora_onboarding_token_connection_bindings VALUES(?1,'provider-1',?2,?3,'google',?4,1)`).bind(token.id,scope.tenantId,scope.workspaceId,token.rotation_generation),
		env.db.prepare(`INSERT INTO nexora_connections(id,tenant_id,workspace_id,provider,account_id,onboarding_mission_id,provider_connection_id,provider_connection_generation,credential_reference_id,credential_generation,state,connection_generation,lease_owner,lease_expires_at,fencing_token) VALUES('connection-1',?1,?2,'google',5,'mission-1','provider-1',1,?3,1,'CONNECTED',2,'health-owner',datetime('now','+5 minutes'),7)`).bind(scope.tenantId,scope.workspaceId,token.id),
		env.db.prepare(`INSERT INTO nexora_connection_operations VALUES('operation-1','connection-1',?1,?2,'HEALTH','LEASED','health-owner',datetime('now','+5 minutes'),7)`).bind(scope.tenantId,scope.workspaceId),
	]);
});

describe('Provider Session authority boundary',()=>{
	it('uses an exact leased operation and exposes only an opaque read-only session',async()=>{
		let observedAuthorization='';
		const fetchImpl=async(_url,init)=>{observedAuthorization=init.headers.authorization;return {ok:true,status:200,headers:new Headers()};};
		const session=await providerSession.acquireProviderSession(context,scope,{connectionId:'connection-1',operationId:'operation-1',leaseOwner:'health-owner',purpose:'health',expectedConnectionGeneration:2,fencingToken:7,fetchImpl});
		await expect(session.evaluateHealth({timeoutMs:500})).resolves.toMatchObject({classification:'HEALTHY',mailboxMutated:false});
		expect(observedAuthorization).toBe('Bearer access-secret');
		expect(()=>JSON.stringify(session)).toThrow('provider_session_not_serializable');
		session.close();
		await expect(session.evaluateHealth()).rejects.toThrow('provider_session_closed');
	});

	it('rejects a session request not bound to the leased operation',async()=>{
		await expect(providerSession.acquireProviderSession(context,scope,{connectionId:'connection-1',operationId:'wrong',leaseOwner:'health-owner',purpose:'health',expectedConnectionGeneration:2,fencingToken:7,fetchImpl:async()=>{throw new Error('network forbidden');}})).rejects.toThrow('provider_session_operation_authority_stale');
	});
});
