import tokenStorage from './nexora-onboarding-token-storage-service.js';
import adapterRegistry from './connection-adapter-registry.js';
import tokenExchange from './nexora-onboarding-token-exchange-service.js';

async function acquireProviderSession(c, scope, { connectionId, operationId, leaseOwner, purpose, expectedConnectionGeneration, fencingToken, fetchImpl=fetch }) {
	if (purpose !== 'health' || !operationId || !leaseOwner) throw new Error('provider_session_operation_authority_incomplete');
	const row=await c.env.db.prepare(`SELECT * FROM nexora_connections WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3`).bind(connectionId,scope.tenantId,scope.workspaceId).first();
	if(!row) throw new Error('connection_scope_denied');
	if(Number(row.connection_generation)!==Number(expectedConnectionGeneration)) throw new Error('connection_generation_stale');
	if(!row.lease_expires_at||Date.parse(`${row.lease_expires_at}Z`)<=Date.now()) throw new Error('connection_lease_inactive');
	if(Number(row.fencing_token)!==Number(fencingToken)) throw new Error('connection_fence_stale');
	if(row.lease_owner!==leaseOwner) throw new Error('connection_lease_owner_stale');
	if(['SUSPENDED','REVOKED','DISCONNECTED','FAILED_TERMINAL'].includes(row.state)) throw new Error('connection_state_denied');
	if(!row.credential_reference_id||!row.onboarding_mission_id) throw new Error('connection_credential_reference_missing');
	const operation=await c.env.db.prepare(`SELECT id FROM nexora_connection_operations WHERE id=?1 AND connection_id=?2 AND tenant_id=?3 AND workspace_id=?4 AND operation_type='HEALTH' AND state='LEASED' AND lease_owner=?5 AND fencing_token=?6 AND lease_expires_at>CURRENT_TIMESTAMP`).bind(operationId,connectionId,scope.tenantId,scope.workspaceId,leaseOwner,fencingToken).first();
	if(!operation) throw new Error('provider_session_operation_authority_stale');
	const adapter=adapterRegistry.getConnectionAdapter(row.provider);
	const stored=await tokenStorage.retrieveForRuntimeUse(c,scope,{ onboardingMissionId:row.onboarding_mission_id,provider:row.provider,credentialReferenceId:row.credential_reference_id,expectedRotationGeneration:row.credential_generation,providerConnectionId:row.provider_connection_id,expectedProviderConnectionGeneration:row.provider_connection_generation,purpose:'provider_health' });
	if(!stored||stored.revoked) throw new Error('connection_credential_unavailable');
	if(!stored.grantedScopes.includes('https://www.googleapis.com/auth/gmail.readonly')) throw new Error('connection_health_scope_missing');
	const changed=await c.env.db.prepare(`UPDATE nexora_connections SET provider_session_generation=provider_session_generation+1,updated_at=CURRENT_TIMESTAMP WHERE id=?1 AND tenant_id=?2 AND workspace_id=?3 AND connection_generation=?4 AND fencing_token=?5 AND lease_expires_at>CURRENT_TIMESTAMP`).bind(connectionId,scope.tenantId,scope.workspaceId,expectedConnectionGeneration,fencingToken).run();
	if(!changed.meta?.changes) throw new Error('connection_session_fence_rejected');
	let closed=false;
	const session={
		provider:row.provider, connectionId, operationId, purpose, generation:Number(row.provider_session_generation)+1,
		async evaluateHealth(policy={}) { if(closed) throw new Error('provider_session_closed'); return adapter.evaluateHealth({ accessToken:stored.accessToken, fetchImpl, timeoutMs:policy.timeoutMs }); },
		close(){ closed=true; },
		toJSON(){ throw new Error('provider_session_not_serializable'); }
	};
	return Object.freeze(session);
}

async function acquireRefreshSession(c, scope, { work, credentialReferenceId, providerConnectionId, providerConnectionGeneration, fetchImpl }) {
	const runtimeEnabled=String(c.env.NEXORA_CONNECTION_RUNTIME_ENABLED||'false').toLowerCase()==='true';
	const authority=runtimeEnabled
		? await c.env.db.prepare(`SELECT c.id FROM nexora_connections c JOIN nexora_onboarding_refresh_work w ON w.onboarding_mission_id=c.onboarding_mission_id AND w.tenant_id=c.tenant_id AND w.workspace_id=c.workspace_id AND w.provider=c.provider WHERE w.id=?1 AND w.status='leased' AND w.lease_token=?2 AND w.fence_generation=?3 AND w.lease_expires_at>CURRENT_TIMESTAMP AND c.credential_reference_id=?4 AND c.credential_generation=?5 AND c.provider_connection_id=?6 AND c.provider_connection_generation=?7 AND c.state IN ('CONNECTED','HEALTHY','DEGRADED','RETRY_WAIT')`).bind(work.id,work.lease_token,work.fence_generation,credentialReferenceId,work.expected_token_generation,providerConnectionId,providerConnectionGeneration).first()
		: await c.env.db.prepare(`SELECT pc.id FROM nexora_onboarding_refresh_work w JOIN nexora_onboarding_provider_connections pc ON pc.onboarding_mission_id=w.onboarding_mission_id AND pc.tenant_id=w.tenant_id AND pc.workspace_id=w.workspace_id AND pc.provider=w.provider WHERE w.id=?1 AND w.status='leased' AND w.lease_token=?2 AND w.fence_generation=?3 AND w.lease_expires_at>CURRENT_TIMESTAMP AND pc.id=?4 AND pc.generation=?5 AND pc.connection_state='active'`).bind(work.id,work.lease_token,work.fence_generation,providerConnectionId,providerConnectionGeneration).first();
	if(!authority) throw new Error('provider_refresh_session_authority_stale');
	const stored=await tokenStorage.retrieveForRuntimeUse(c,scope,{ onboardingMissionId:work.onboarding_mission_id,provider:work.provider,credentialReferenceId,expectedRotationGeneration:work.expected_token_generation,providerConnectionId,expectedProviderConnectionGeneration:providerConnectionGeneration,purpose:'refresh' });
	if(!stored||stored.revoked) throw new Error('provider_refresh_credential_unavailable');
	let closed=false;
	return Object.freeze({
		provider:work.provider,purpose:'refresh',connectionId:authority.id,workId:work.id,
		async refreshAndCommit(){
			if(closed) throw new Error('provider_session_closed');
			const result=await tokenExchange.refreshAccessToken(c.env,{ provider:work.provider,refreshToken:stored.refreshToken },fetchImpl);
			if(!result.ok) return { result, committed:null };
			const committed=await tokenStorage.commitRefreshWithFence(c,scope,{ onboardingMissionId:work.onboarding_mission_id,provider:work.provider,expectedRotationGeneration:work.expected_token_generation,refreshWorkId:work.id,leaseToken:work.lease_token,fenceGeneration:work.fence_generation,refreshToken:result.refreshToken||stored.refreshToken,accessToken:result.accessToken,accessTokenExpiresAt:result.expiresAt,grantedScopes:result.grantedScopes.length?result.grantedScopes:stored.grantedScopes });
			return { result, committed };
		},
		close(){closed=true;},
		toJSON(){throw new Error('provider_session_not_serializable');},
	});
}
export { acquireProviderSession, acquireRefreshSession };
export default { acquireProviderSession, acquireRefreshSession };
