import { describe, expect, it, vi } from 'vitest';
import contract, { assertTransition, transitionAllowed, validateScope } from '../../src/service/connection-contract-service.js';
import gmailAdapter, { HEALTH_URL, classify } from '../../src/service/gmail-connection-adapter.js';
import { assertRollout } from '../../src/service/connection-runtime-service.js';

const rollout = (overrides = {}) => ({
	NEXORA_CONNECTION_RUNTIME_ENABLED: 'true',
	NEXORA_CONNECTION_RUNTIME_EMERGENCY_DISABLED: 'false',
	NEXORA_CONNECTION_PROVIDER_ALLOWLIST: 'google',
	NEXORA_CONNECTION_TENANT_ALLOWLIST: '41',
	NEXORA_CONNECTION_WORKSPACE_ALLOWLIST: '42',
	NEXORA_CONNECTION_ACCOUNT_ALLOWLIST: '43',
	...overrides,
});
const input = (overrides = {}) => ({ tenant_id: 41, workspace_id: 42, actor_user_id: 41, account_id: 43, authority_generation: 1, provider: 'google', ...overrides });

describe('Connection contract is fail-closed', () => {
	it.each([
		['DISCOVERED','AUTHORIZATION_PENDING'], ['DISCOVERED','CONNECTED'], ['CONNECTED','HEALTHY'], ['HEALTHY','REFRESH_PENDING'],
		['REFRESH_PENDING','RETRY_WAIT'], ['RETRY_WAIT','REAUTHORIZATION_REQUIRED'], ['REAUTHORIZATION_REQUIRED','AUTHORIZATION_PENDING'],
		['CALLBACK_PENDING','CONNECTED'], ['CONNECTED','SUSPENDED'], ['CONNECTED','REVOKED'],
	])('allows the explicit %s -> %s transition', (from, to) => expect(transitionAllowed(from, to)).toBe(true));

	it.each([
		['REVOKED','CONNECTED'], ['FAILED_TERMINAL','DISCOVERED'], ['HEALTHY','CONNECTED'], ['AUTHORIZATION_PENDING','HEALTHY'],
		['CALLBACK_PENDING','HEALTHY'], ['REAUTHORIZATION_REQUIRED','HEALTHY'], ['DISCOVERED','HEALTHY'], ['SUSPENDED','HEALTHY'],
	])('rejects the implicit %s -> %s transition', (from, to) => expect(() => assertTransition(from, to)).toThrow('connection_transition_rejected'));

	it('requires positive tenant/workspace/actor/account and nonnegative authority generation', () => {
		expect(validateScope(input())).toMatchObject({ tenantId: 41, workspaceId: 42, actorUserId: 41, accountId: 43, authorityGeneration: 1 });
		for (const field of ['tenant_id','workspace_id','actor_user_id','account_id']) expect(() => validateScope(input({ [field]: 0 }))).toThrow();
		expect(() => validateScope(input({ authority_generation: -1 }))).toThrow();
	});

	it.each([
		[{}, 'connection_runtime_disabled'],
		[{ NEXORA_CONNECTION_RUNTIME_ENABLED: 'true' }, 'connection_runtime_emergency_disabled'],
		[rollout({ NEXORA_CONNECTION_PROVIDER_ALLOWLIST: 'google,microsoft' }), 'connection_provider_not_allowlisted'],
		[rollout({ NEXORA_CONNECTION_TENANT_ALLOWLIST: '999' }), 'connection_tenant_not_allowlisted'],
		[rollout({ NEXORA_CONNECTION_WORKSPACE_ALLOWLIST: '999' }), 'connection_workspace_not_allowlisted'],
		[rollout({ NEXORA_CONNECTION_ACCOUNT_ALLOWLIST: '999' }), 'connection_account_not_allowlisted'],
	])('rejects rollout mismatch %#', (env, code) => expect(() => assertRollout(env, input())).toThrow(code));

	it('requires exactly one selected provider, tenant, workspace, and account', () => expect(() => assertRollout(rollout(), input())).not.toThrow());
	it('publishes all required durable states and operation contracts', () => {
		expect(contract.STATES).toContain('REAUTHORIZATION_REQUIRED');
		expect(contract.OPERATIONS.evaluate_connection).toMatchObject({ lease: true, evidence: true });
		expect(contract.OPERATIONS.refresh_connection.retry).toBe('bounded_backoff');
	});
});

describe('Gmail health adapter is bounded and read-only', () => {
	it.each([[200,'HEALTHY'],[204,'HEALTHY'],[401,'REAUTHORIZATION_REQUIRED'],[403,'REAUTHORIZATION_REQUIRED'],[429,'RATE_LIMITED'],[500,'PROVIDER_TRANSIENT'],[400,'PROVIDER_REJECTED']])('classifies %i as %s', (status, expected) => expect(classify(status).classification).toBe(expected));

	it('does not call the provider without access authority', async () => {
		const fetchImpl = vi.fn();
		const result = await gmailAdapter.evaluateHealth({ accessToken: null, fetchImpl });
		expect(fetchImpl).not.toHaveBeenCalled();
		expect(result).toMatchObject({ providerNetworkCalled: false, mailboxMutated: false, reauthorizationRequired: true });
	});

	it('performs exactly one no-store GET and never reads or persists the response body', async () => {
		const json = vi.fn(() => { throw new Error('body must not be read'); });
		const fetchImpl = vi.fn(async () => ({ status: 200, json }));
		const result = await gmailAdapter.evaluateHealth({ accessToken: 'fixture-only', fetchImpl, timeoutMs: 500 });
		expect(fetchImpl).toHaveBeenCalledTimes(1);
		const [url, init] = fetchImpl.mock.calls[0];
		expect(url).toBe(HEALTH_URL);
		expect(init).toMatchObject({ method: 'GET', cache: 'no-store', redirect: 'error' });
		expect(json).not.toHaveBeenCalled();
		expect(result).toMatchObject({ classification: 'HEALTHY', providerNetworkCalled: true, mailboxMutated: false });
	});

	it('classifies timeout/network ambiguity as retryable without mutation', async () => {
		const result = await gmailAdapter.evaluateHealth({ accessToken: 'fixture-only', fetchImpl: async () => { throw new Error('network'); } });
		expect(result).toMatchObject({ classification: 'PROVIDER_OUTCOME_AMBIGUOUS', retryable: true, mailboxMutated: false });
	});
});
