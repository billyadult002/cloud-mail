import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import selector from '../../src/service/nexora-workspace-authority-service.mjs';

const actor = { userId: 7001 };
const c = {
	env: {
		...env,
		CF_VERSION_METADATA: { id: 'test-worker-version' },
		NEXORA_CORRELATION_HASH_SECRET: 'test-only-workspace-selector-hmac-secret',
		NEXORA_CORRELATION_HMAC_KEY_VERSION: 'test-v1'
	},
	req: { header: (name) => name.toLowerCase() === 'cf-ray' ? 'test-ray' : null }
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
		const result = await selector.assertWorkspaceCapability(c, actor, 7101, 'domain:write');
		expect(result.workspace).toMatchObject({ id: 7101, role: 'OWNER' });
		expect(result.selectionEvidence).toMatchObject({ requestId: 'test-ray', runtimeDeploymentId: 'test-worker-version', redactionLevel: 'BODYLESS' });
		expect(result.selectionEvidence.workspaceSelectionRef).toBeTruthy();
	});

	it('rejects unknown, cross-actor, viewer, and cross-tenant choices', async () => {
		await expect(selector.assertWorkspaceCapability(c, actor, 9999)).rejects.toThrow('workspace authority');
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
