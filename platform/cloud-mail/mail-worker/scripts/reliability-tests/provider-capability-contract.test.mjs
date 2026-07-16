import { describe, expect, it } from 'vitest';
import { decide } from '../../src/service/provider-capability-contract-service.js';
const base = { scopeValid:true, identityValid:true, credentialStatus:'active', credentialGenerationValid:true, authorityStatus:'active', policyAllowed:true, approvalValid:true, paramsValid:true, fencingValid:true, requirement:{requiredCapabilities:['read'],approvalRequired:false,allowDegraded:false}, capabilities:[{key:'read',status:'supported',expiresAt:'2099-01-01T00:00:00.000Z'}] };
describe('provider capability authorization contract', () => {
	it('separates credential, authority, capability, reconnect and temporary failure', () => {
		expect(decide({...base, credentialStatus:'active', authorityStatus:'missing'}).result).toBe('authorization_missing');
		expect(decide({...base, credentialStatus:'missing'}).result).toBe('needs_reconnect');
		expect(decide({...base, capabilities:[{key:'read',status:'temporarily_unavailable'}]}).result).toBe('temporarily_unavailable');
		expect(decide({...base, capabilities:[{key:'read',status:'unsupported'}]}).result).toBe('capability_unavailable');
	});
	it('requires exact approval and blocks stale or mismatched dispatch', () => {
		expect(decide({...base, requirement:{...base.requirement,approvalRequired:true}, approvalValid:false}).result).toBe('approval_required');
		expect(decide({...base, credentialGenerationValid:false}).result).toBe('authorization_stale');
		expect(decide({...base, paramsValid:false}).providerToolPermitted).toBe(false);
	});
});
