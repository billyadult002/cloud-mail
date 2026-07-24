import { beforeEach, describe, expect, it } from 'vitest';
import { env } from 'cloudflare:test';
import app from '../../src/hono/webs.js';

const MIGRATION_SCHEMA = [
	`CREATE TABLE user(user_id INTEGER PRIMARY KEY,email TEXT NOT NULL DEFAULT 'owner@example.test')`,
	`CREATE TABLE account(account_id INTEGER PRIMARY KEY,email TEXT NOT NULL DEFAULT '',name TEXT NOT NULL DEFAULT '',user_id INTEGER,is_del INTEGER NOT NULL DEFAULT 0)`,
	`CREATE TABLE workspaces(id INTEGER PRIMARY KEY,tenant_key TEXT NOT NULL,display_name TEXT NOT NULL,created_by_user_id INTEGER NOT NULL)`,
	`CREATE TABLE workspace_members(workspace_id INTEGER,user_id INTEGER,role TEXT)`,
	`CREATE TABLE setting(
	 register INTEGER NOT NULL DEFAULT 0,receive INTEGER NOT NULL DEFAULT 0,title TEXT NOT NULL DEFAULT '',
	 many_email INTEGER NOT NULL DEFAULT 0,add_email INTEGER NOT NULL DEFAULT 0,auto_refresh INTEGER NOT NULL DEFAULT 0,
	 add_email_verify INTEGER NOT NULL DEFAULT 1,register_verify INTEGER NOT NULL DEFAULT 1,reg_verify_count INTEGER NOT NULL DEFAULT 1,
	 add_verify_count INTEGER NOT NULL DEFAULT 1,send INTEGER NOT NULL DEFAULT 1,r2_domain TEXT,secret_key TEXT,site_key TEXT,
	 reg_key INTEGER NOT NULL DEFAULT 0,background TEXT,tg_bot_token TEXT NOT NULL DEFAULT '',tg_chat_id TEXT NOT NULL DEFAULT '',
	 tg_bot_status INTEGER NOT NULL DEFAULT 1,forward_email TEXT NOT NULL DEFAULT '',forward_status INTEGER NOT NULL DEFAULT 1,
	 rule_email TEXT NOT NULL DEFAULT '',rule_type INTEGER NOT NULL DEFAULT 0,login_opacity REAL DEFAULT 0.88,
	 resend_tokens TEXT NOT NULL DEFAULT '{}',notice_title TEXT NOT NULL DEFAULT '',notice_content TEXT NOT NULL DEFAULT '',
	 notice_type TEXT NOT NULL DEFAULT '',notice_duration INTEGER NOT NULL DEFAULT 0,notice_position TEXT NOT NULL DEFAULT '',
	 notice_offset INTEGER NOT NULL DEFAULT 0,notice_width INTEGER NOT NULL DEFAULT 400,notice INTEGER NOT NULL DEFAULT 0,
	 no_recipient INTEGER NOT NULL DEFAULT 1,login_domain INTEGER NOT NULL DEFAULT 0,bucket TEXT NOT NULL DEFAULT '',
	 region TEXT NOT NULL DEFAULT '',endpoint TEXT NOT NULL DEFAULT '',s3_access_key TEXT NOT NULL DEFAULT '',
	 s3_secret_key TEXT NOT NULL DEFAULT '',force_path_style INTEGER NOT NULL DEFAULT 1,custom_domain TEXT NOT NULL DEFAULT '',
	 tg_msg_from TEXT NOT NULL DEFAULT 'only-name',tg_msg_to TEXT NOT NULL DEFAULT 'show',tg_msg_text TEXT NOT NULL DEFAULT 'hide',
	 min_email_prefix INTEGER NOT NULL DEFAULT 0,email_prefix_filter TEXT NOT NULL DEFAULT ''
	)`,
	`CREATE TABLE nexora_staging_bootstrap_operations(
	 singleton_id INTEGER PRIMARY KEY CHECK(singleton_id=1),operation_id TEXT NOT NULL UNIQUE,
	 request_digest TEXT NOT NULL CHECK(length(request_digest)=64),state TEXT NOT NULL CHECK(state IN ('DB_COMMITTED','KV_REFRESHING','READY_FOR_FIRST_AUTHORITY','FIRST_USER_CREATED','COMPLETE')),
	 worker_version TEXT NOT NULL DEFAULT '',refresh_owner TEXT,refresh_lease_expires_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
	 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at TEXT
	)`,
	`CREATE TRIGGER trg_nexora_staging_bootstrap_zero_authority BEFORE INSERT ON nexora_staging_bootstrap_operations
	 WHEN (SELECT COUNT(*) FROM setting)<>0 OR (SELECT COUNT(*) FROM user)<>0 OR (SELECT COUNT(*) FROM account)<>0 OR (SELECT COUNT(*) FROM workspaces)<>0
	 BEGIN SELECT RAISE(ABORT,'secure_staging_bootstrap_precondition_failed'); END`,
	`CREATE TRIGGER trg_nexora_staging_bootstrap_no_delete BEFORE DELETE ON nexora_staging_bootstrap_operations
	 BEGIN SELECT RAISE(ABORT,'secure_staging_bootstrap_immutable'); END`,
	`CREATE TRIGGER trg_nexora_staging_bootstrap_single_first_user BEFORE INSERT ON user
	 WHEN EXISTS(SELECT 1 FROM nexora_staging_bootstrap_operations WHERE singleton_id=1 AND state IN ('READY_FOR_FIRST_AUTHORITY','FIRST_USER_CREATED'))
	  AND (SELECT COUNT(*) FROM user)<>0
	 BEGIN SELECT RAISE(ABORT,'secure_staging_bootstrap_first_authority_already_claimed'); END`,
	`CREATE TRIGGER trg_nexora_staging_bootstrap_first_account AFTER INSERT ON user
	 WHEN EXISTS(SELECT 1 FROM nexora_staging_bootstrap_operations WHERE singleton_id=1 AND state='READY_FOR_FIRST_AUTHORITY')
	 BEGIN
	  INSERT INTO account(email,name,user_id) VALUES(NEW.email,substr(NEW.email,1,instr(NEW.email,'@')-1),NEW.user_id);
	  UPDATE nexora_staging_bootstrap_operations SET state='FIRST_USER_CREATED',updated_at=CURRENT_TIMESTAMP WHERE singleton_id=1 AND state='READY_FOR_FIRST_AUTHORITY';
	 END`,
	`CREATE TRIGGER trg_nexora_staging_bootstrap_valid_update BEFORE UPDATE ON nexora_staging_bootstrap_operations
	 WHEN OLD.singleton_id<>NEW.singleton_id OR OLD.operation_id<>NEW.operation_id OR OLD.request_digest<>NEW.request_digest
	  OR OLD.worker_version<>NEW.worker_version OR OLD.created_at<>NEW.created_at OR OLD.state='COMPLETE'
	  OR NOT (
	   (OLD.state='DB_COMMITTED' AND NEW.state='KV_REFRESHING' AND NEW.refresh_owner IS NOT NULL AND NEW.refresh_lease_expires_at IS NOT NULL AND NEW.completed_at IS NULL)
	   OR (OLD.state='KV_REFRESHING' AND NEW.state='KV_REFRESHING' AND OLD.refresh_lease_expires_at<=CURRENT_TIMESTAMP AND NEW.refresh_owner IS NOT NULL AND NEW.refresh_lease_expires_at IS NOT NULL AND NEW.completed_at IS NULL)
	   OR (OLD.state='KV_REFRESHING' AND NEW.state='DB_COMMITTED' AND NEW.refresh_owner IS NULL AND NEW.refresh_lease_expires_at IS NULL AND NEW.completed_at IS NULL)
	   OR (OLD.state='KV_REFRESHING' AND NEW.state='READY_FOR_FIRST_AUTHORITY' AND NEW.refresh_owner IS NULL AND NEW.refresh_lease_expires_at IS NULL AND NEW.completed_at IS NULL)
	   OR (OLD.state='READY_FOR_FIRST_AUTHORITY' AND NEW.state='FIRST_USER_CREATED' AND (SELECT COUNT(*) FROM user)=1 AND (SELECT COUNT(*) FROM account)>=1 AND NEW.completed_at IS NULL)
	   OR (OLD.state='FIRST_USER_CREATED' AND NEW.state='COMPLETE' AND (SELECT COUNT(*) FROM user)=1 AND EXISTS(SELECT 1 FROM account a JOIN workspace_members wm ON wm.user_id=a.user_id JOIN workspaces w ON w.id=wm.workspace_id WHERE a.user_id=(SELECT user_id FROM user LIMIT 1) AND a.is_del=0 AND wm.role='OWNER') AND NEW.completed_at IS NOT NULL)
	  )
	 BEGIN SELECT RAISE(ABORT,'secure_staging_bootstrap_invalid_transition'); END`,
];

const secret = 'test-only-bootstrap-secret-at-least-32-bytes';
const staging = {
	...env,
	CLOUDFLARE_EMAIL_WORKER: 'cloud-mail-staging',
	NEXORA_STAGING_SECURE_BOOTSTRAP_ENABLED: 'true',
	NEXORA_STAGING_BOOTSTRAP_SECRET: secret,
	CF_VERSION_METADATA: { id: 'test-worker-version' },
};

async function reset() {
	for (const table of ['nexora_staging_bootstrap_operations', 'setting', 'workspace_members', 'workspaces', 'account', 'user']) {
		await env.db.prepare(`DROP TABLE IF EXISTS ${table}`).run();
	}
	for (const sql of MIGRATION_SCHEMA) await env.db.prepare(sql).run();
	await env.kv.delete('setting:');
}

async function post(value = secret, bindings = staging) {
	return app.request('/init/secure', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ bootstrap_secret: value }),
	}, bindings);
}

beforeEach(reset);

describe('secure staging bootstrap boundary', () => {
	it('denies production, disabled, missing, and wrong credentials without writes', async () => {
		expect((await post(secret, { ...staging, CLOUDFLARE_EMAIL_WORKER: 'cloud-mail' })).status).toBe(404);
		expect((await post(secret, { ...staging, NEXORA_STAGING_SECURE_BOOTSTRAP_ENABLED: 'false' })).status).toBe(403);
		expect((await post('')).status).toBe(401);
		expect((await post('wrong')).status).toBe(401);
		expect((await env.db.prepare(`SELECT COUNT(*) count FROM setting`).first()).count).toBe(0);
		expect((await env.db.prepare(`SELECT COUNT(*) count FROM nexora_staging_bootstrap_operations`).first()).count).toBe(0);
	});

	it('denies cross-site browser submission even with the correct secret', async () => {
		const response = await app.request('/init/secure', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				origin: 'https://attacker.example',
				'sec-fetch-site': 'cross-site',
			},
			body: JSON.stringify({ bootstrap_secret: secret }),
		}, staging);
		expect(response.status).toBe(403);
		expect((await env.db.prepare(`SELECT COUNT(*) count FROM setting`).first()).count).toBe(0);
	});

	it('denies the legacy URL-secret initializer in staging without reflecting the path value', async () => {
		const marker = 'must-not-be-reflected';
		const response = await app.request(`/init/${marker}`, {}, staging);
		expect(response.status).toBe(404);
		expect(await response.text()).not.toContain(marker);
		expect((await env.db.prepare(`SELECT COUNT(*) count FROM setting`).first()).count).toBe(0);
	});

	it('creates exactly one setting, refreshes KV, and waits for the credential-bound first authority', async () => {
		const response = await post();
		expect(response.status).toBe(200);
		const body = await response.json();
		expect(body).toMatchObject({ state: 'READY_FOR_FIRST_AUTHORITY', workerVersion: 'test-worker-version' });
		expect(JSON.stringify(body)).not.toContain(secret);
		expect((await env.db.prepare(`SELECT COUNT(*) count FROM setting`).first()).count).toBe(1);
		expect((await env.db.prepare(`SELECT COUNT(*) count FROM nexora_staging_bootstrap_operations WHERE state='READY_FOR_FIRST_AUTHORITY'`).first()).count).toBe(1);
		expect(await env.kv.get('setting:', { type: 'json' })).toMatchObject({ register: 0, regKey: 0, resendTokens: {} });
		expect((await post()).status).toBe(409);
		expect((await env.db.prepare(`SELECT COUNT(*) count FROM setting`).first()).count).toBe(1);
	});

	it('has one winner under concurrent requests', async () => {
		const responses = await Promise.all([post(), post()]);
		expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
		expect((await env.db.prepare(`SELECT COUNT(*) count FROM setting`).first()).count).toBe(1);
		expect((await env.db.prepare(`SELECT COUNT(*) count FROM nexora_staging_bootstrap_operations`).first()).count).toBe(1);
	});

	it('recovers a committed D1 bootstrap after a KV failure without inserting again', async () => {
		const unavailableKv = {
			put: async () => { throw new Error('simulated-kv-outage'); },
		};
		const failed = await post(secret, { ...staging, kv: unavailableKv });
		expect(failed.status).toBe(503);
		expect(await failed.json()).toMatchObject({ state: 'DB_COMMITTED', retryable: true });
		expect((await env.db.prepare(`SELECT COUNT(*) count FROM setting`).first()).count).toBe(1);
		expect((await env.db.prepare(`SELECT state FROM nexora_staging_bootstrap_operations WHERE singleton_id=1`).first()).state).toBe('DB_COMMITTED');

		const recovered = await post();
		expect(recovered.status).toBe(200);
		expect(await recovered.json()).toMatchObject({ state: 'READY_FOR_FIRST_AUTHORITY' });
		expect((await env.db.prepare(`SELECT COUNT(*) count FROM setting`).first()).count).toBe(1);
	});

	it('fails closed when any canonical authority or setting row already exists', async () => {
		await env.db.prepare(`INSERT INTO user(user_id) VALUES(1)`).run();
		const response = await post();
		expect(response.status).toBe(409);
		expect((await env.db.prepare(`SELECT COUNT(*) count FROM setting`).first()).count).toBe(0);
		expect((await env.db.prepare(`SELECT COUNT(*) count FROM nexora_staging_bootstrap_operations`).first()).count).toBe(0);
	});

	it('rolls back the operation claim when the setting insert fails', async () => {
		await env.db.prepare(`DROP TABLE setting`).run();
		await env.db.prepare(`CREATE TABLE setting(required_value TEXT NOT NULL)`).run();
		const response = await post();
		expect(response.status).toBe(409);
		expect((await env.db.prepare(`SELECT COUNT(*) count FROM nexora_staging_bootstrap_operations`).first()).count).toBe(0);
	});

	it('preserves an immutable ledger after completion', async () => {
		expect((await post()).status).toBe(200);
		expect(await (await import('../../src/service/nexora-secure-staging-bootstrap-service.js')).default.authorizeFirstAuthority({ env: staging }, 'wrong')).toBe(false);
		expect(await (await import('../../src/service/nexora-secure-staging-bootstrap-service.js')).default.requiresFirstAuthority({ env: staging })).toBe(true);
		expect(await (await import('../../src/service/nexora-secure-staging-bootstrap-service.js')).default.authorizeFirstAuthority({ env: staging }, secret)).toBe(true);
		await env.db.prepare(`INSERT INTO user(user_id) VALUES(1)`).run();
		await expect(env.db.prepare(`INSERT INTO user(user_id) VALUES(2)`).run()).rejects.toThrow();
		expect((await env.db.prepare(`SELECT user_id FROM account`).first()).user_id).toBe(1);
		expect((await env.db.prepare(`SELECT state FROM nexora_staging_bootstrap_operations`).first()).state).toBe('FIRST_USER_CREATED');
		const completed = await app.request('/init/secure/complete-authority', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ bootstrap_secret: secret }),
		}, staging);
		expect(completed.status).toBe(200);
		const replay = await app.request('/init/secure/complete-authority', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ bootstrap_secret: secret }),
		}, staging);
		expect(replay.status).toBe(409);
		await expect(env.db.prepare(`DELETE FROM nexora_staging_bootstrap_operations`).run()).rejects.toThrow();
		await expect(env.db.prepare(`UPDATE nexora_staging_bootstrap_operations SET state='DB_COMMITTED'`).run()).rejects.toThrow();
	});
});
