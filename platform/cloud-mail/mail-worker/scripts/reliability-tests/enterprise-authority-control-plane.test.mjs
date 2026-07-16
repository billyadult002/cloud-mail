import { describe, expect, it } from 'vitest';
import { DELEGATION_SCOPES, MEMBERSHIP_SCOPES, evaluateRuntimeAuthority } from '../../src/service/enterprise-authority-service.js';

const activeMembership={state:'active',expires_at:'2099-01-01T00:00:00.000Z'};
const activeDelegation={id:'d1',state:'active',owner_consent_at:'2026-01-01T00:00:00.000Z',approved_at:'2026-01-02T00:00:00.000Z',expires_at:'2099-01-01T00:00:00.000Z',scope:['account_state_visibility'],authority_generation:4};

describe('enterprise identity membership and delegation control plane',()=>{
	it('allows only the P0 visibility scopes',()=>{
		expect([...MEMBERSHIP_SCOPES]).toEqual(['workspace_visibility','account_state_visibility']);
		expect([...DELEGATION_SCOPES]).toEqual(['account_state_visibility','metadata_read']);
		for(const forbidden of ['mail_body_read','mail_send','oauth_manage','credential_access','account_reconnect']) {
			expect(MEMBERSHIP_SCOPES.has(forbidden)||DELEGATION_SCOPES.has(forbidden)).toBe(false);
		}
	});
	it('requires membership and separate active owner-consented delegation',()=>{
		expect(evaluateRuntimeAuthority({membership:null,ownerUserId:2,actingUserId:1,delegation:null,capability:'account_state_visibility'}).reason).toBe('workspace_membership_missing');
		expect(evaluateRuntimeAuthority({membership:activeMembership,ownerUserId:2,actingUserId:1,delegation:null,capability:'account_state_visibility'}).reason).toBe('account_delegation_missing');
		expect(evaluateRuntimeAuthority({membership:activeMembership,ownerUserId:2,actingUserId:1,delegation:{...activeDelegation,owner_consent_at:null},capability:'account_state_visibility'}).allowed).toBe(false);
		expect(evaluateRuntimeAuthority({membership:activeMembership,ownerUserId:2,actingUserId:1,delegation:activeDelegation,capability:'account_state_visibility'})).toMatchObject({allowed:true,authorityGeneration:4,delegationId:'d1'});
	});
	it('denies expired, revoked and scope-mismatched relationships',()=>{
		expect(evaluateRuntimeAuthority({membership:{...activeMembership,state:'revoked'},ownerUserId:2,actingUserId:1,delegation:activeDelegation,capability:'account_state_visibility'}).allowed).toBe(false);
		expect(evaluateRuntimeAuthority({membership:activeMembership,ownerUserId:2,actingUserId:1,delegation:{...activeDelegation,expires_at:'2020-01-01T00:00:00.000Z'},capability:'account_state_visibility'}).allowed).toBe(false);
		expect(evaluateRuntimeAuthority({membership:activeMembership,ownerUserId:2,actingUserId:1,delegation:activeDelegation,capability:'metadata_read'}).reason).toBe('delegation_scope_mismatch');
	});
	it('preserves owner access but still requires Workspace membership',()=>{
		expect(evaluateRuntimeAuthority({membership:activeMembership,ownerUserId:1,actingUserId:1,delegation:null,capability:'account_state_visibility'}).reason).toBe('account_owner');
		expect(evaluateRuntimeAuthority({membership:null,ownerUserId:1,actingUserId:1,delegation:null,capability:'account_state_visibility'}).allowed).toBe(false);
	});
});
