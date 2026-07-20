import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import selector from '../../src/service/nexora-workspace-authority-service.mjs';

const actor = { userId: 7001, email: 'Admin@Example.test' };
const c = {
	env: {
		...env,
		CF_VERSION_METADATA: { id: 'test-worker-version' },
		NEXORA_CORRELATION_HASH_SECRET: 'test-only-workspace-selector-hmac-secret',
		NEXORA_CORRELATION_HMAC_KEY_VERSION: 'test-v1'
	},
	req: { header: (name) => ({ 'cf-ray': 'test-ray', authorization: 'Bearer actor-session' })[name.toLowerCase()] || null }
};

async function reset() {
	await env.db.prepare('DROP TABLE IF EXISTS workspace_members').run();
	await env.db.prepare('DROP TABLE IF EXISTS workspaces').run();
	await env.db.prepare('CREATE TABLE workspaces(id INTEGER PRIMARY KEY,tenant_key TEXT,display_name TEXT,created_by_user_id INTEGER)').run();
	await env.db.prepare('CREATE TABLE workspace_members(workspace_id INTEGER,user_id INTEGER,role TEXT,PRIMARY KEY(workspace_id,user_id))').run();
	await env.db.prepare("INSERT INTO workspaces VALUES(7101,'user:7001','Primary',7001),(7102,'user:7001','Secondary',7001),(7103,'user:8001','Foreign',8001)").run();
	await env.db.prepare("INSERT INTO workspace_members VALUES(7101,7001,'OWNER'),(7102,7001,'VIEWER'),(7103,8001,'OWNER')").run();
}

describe('actor-scoped workspace authority selector', () => {
	beforeEach(reset);

	it('lists only actor memberships without selecting from domain or account hints', async () => {
		const rows = await selector.listActorWorkspaces(c, actor);
		expect(rows.map((row) => row.workspaceId)).toEqual([7101, 7102]);
		expect(rows[0].canActivateDomain).toBe(true);
		expect(rows[1].canActivateDomain).toBe(false);
	});

	it('validates an explicit eligible choice and emits server correlation', async () => {
		const result = await selector.assertWorkspaceCapability(c, actor, 7101, 'domain:write', { issueCredential: true });
		expect(result.actor).toMatchObject({ userId: 7001, email: 'admin@example.test' });
		expect(result.actor.actorRef).toMatch(/^[a-f0-9]{64}$/);
		expect(result.workspace).toEqual({
			id: 7101,
			displayName: 'Primary',
			role: 'OWNER',
			capabilities: ['domain:read', 'domain:write'],
			canActivateDomain: true
		});
		expect(result.selectionEvidence).toMatchObject({ requestId: 'test-ray', runtimeDeploymentId: 'test-worker-version', redactionLevel: 'BODYLESS' });
		expect(result.selectionEvidence.workspaceSelectionRef).toBeTruthy();
		expect(result.selectionEvidence.actorRef).toBe(result.actor.actorRef);
		expect(result.workspaceSelectionCredential).toBeTruthy();
		await expect(selector.requireWorkspaceSelectionCredential(c, actor, 7101, 'domain:write', result.workspaceSelectionCredential)).resolves.toMatchObject({ workspaceId: 7101, capability: 'domain:write' });
	});

	it('returns a session-bound safe actor identity for selector discovery', async () => {
		const identity = await selector.resolveActorIdentity(c, actor);
		expect(identity).toEqual({ userId: 7001, email: 'admin@example.test', actorRef: identity.actorRef });
		expect(identity.actorRef).toMatch(/^[a-f0-9]{64}$/);
		expect(JSON.stringify(identity)).not.toContain('actor-session');
	});

	it('does not mint credentials during internal live capability rechecks', async () => {
		const result = await selector.assertWorkspaceCapability(c, actor, 7101, 'domain:write');
		expect(result.workspaceSelectionCredential).toBeUndefined();
	});

	it('rejects missing, tampered, actor/session/workspace/capability substituted credentials', async () => {
		const issued = await selector.assertWorkspaceCapability(c, actor, 7101, 'domain:write', { issueCredential: true });
		const credential = issued.workspaceSelectionCredential;
		await expect(selector.requireWorkspaceSelectionCredential(c, actor, 7101, 'domain:write')).rejects.toMatchObject({ name: 'BizError', code: 403 });
		await expect(selector.requireWorkspaceSelectionCredential(c, actor, 7101, 'domain:write', `${credential}x`)).rejects.toThrow('integrity');
		await expect(selector.requireWorkspaceSelectionCredential(c, { userId: 7002 }, 7101, 'domain:write', credential)).rejects.toThrow('actor');
		await expect(selector.requireWorkspaceSelectionCredential(c, { userId: 7001, email: 'other@example.test' }, 7101, 'domain:write', credential)).rejects.toThrow('actor reference mismatch');
		const otherSession = { ...c, req: { header: (name) => ({ 'cf-ray': 'test-ray', authorization: 'Bearer other-session' })[name.toLowerCase()] || null } };
		await expect(selector.requireWorkspaceSelectionCredential(otherSession, actor, 7101, 'domain:write', credential)).rejects.toThrow('session');
		await expect(selector.requireWorkspaceSelectionCredential(c, actor, 7102, 'domain:write', credential)).rejects.toThrow('workspace');
		await expect(selector.requireWorkspaceSelectionCredential(c, actor, 7101, 'domain:read', credential)).rejects.toThrow('capability');
	});

	it('rejects expired credentials and deployment or key-version continuity changes', async () => {
		const issued = await selector.assertWorkspaceCapability(c, actor, 7101, 'domain:write', { issueCredential: true, now: 1_800_000_000_000, ttlSeconds: 60 });
		await expect(selector.requireWorkspaceSelectionCredential(c, actor, 7101, 'domain:write', issued.workspaceSelectionCredential, { now: 1_800_000_061_000 })).rejects.toThrow('expired');
		const redeployed = { ...c, env: { ...c.env, CF_VERSION_METADATA: { id: 'other-worker-version' } } };
		await expect(selector.requireWorkspaceSelectionCredential(redeployed, actor, 7101, 'domain:write', issued.workspaceSelectionCredential, { now: 1_800_000_001_000 })).rejects.toThrow('deployment');
		const rotated = { ...c, env: { ...c.env, NEXORA_CORRELATION_HMAC_KEY_VERSION: 'test-v2' } };
		await expect(selector.requireWorkspaceSelectionCredential(rotated, actor, 7101, 'domain:write', issued.workspaceSelectionCredential, { now: 1_800_000_001_000 })).rejects.toThrow('key version');
	});

	it('rejects unknown, cross-actor, viewer, and cross-tenant choices', async () => {
		await expect(selector.assertWorkspaceCapability(c, actor, 9999)).rejects.toMatchObject({ name: 'BizError', code: 403 });
		await expect(selector.assertWorkspaceCapability(c, actor, 7103)).rejects.toThrow('workspace authority');
		await expect(selector.assertWorkspaceCapability(c, actor, 7102)).rejects.toThrow('domain:write');
		await env.db.prepare("UPDATE workspace_members SET user_id=7001 WHERE workspace_id=7103").run();
		await expect(selector.assertWorkspaceCapability(c, actor, 7103)).rejects.toThrow('tenant lineage');
	});

	it('rejects malformed actor and workspace identifiers', async () => {
		await expect(selector.listActorWorkspaces(c, {})).rejects.toThrow('authenticated user');
		await expect(selector.assertWorkspaceCapability(c, actor, 'not-a-workspace')).rejects.toThrow('workspaceId');
	});
});
