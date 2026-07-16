// F2 (canonical query redundancy) + F5 (account-delete not-found contract) regression tests.
import { describe, expect, it, vi, beforeEach } from 'vitest';

// ---------- F2: applyCanonicalStates issues exactly one canonical binding query ----------
import emailService from '../../src/service/email-service.js';

function makeCanonDb(canonRows) {
	const prepared = [];
	const db = {
		prepare(sql) {
			prepared.push(sql);
			const stmt = { sql, bind() { return stmt; }, async all() { return { results: /mail_canonical_state/.test(sql) ? canonRows : [] }; } };
			return stmt;
		}
	};
	return { prepared, c: { env: { db } } };
}

describe('F2 applyCanonicalStates — single canonical query', () => {
	it('prepares exactly one canonical query, on workspace_account_bindings (not workspace_mailboxes)', async () => {
		const canonRows = [{ message_id: 10, is_starred: 0, is_read: 1, folder_key: 'inbox', semantic_category: null, is_priority: 0, is_vip: 0, junk_disposition: null, overlays_json: '[]', tags_json: '[]', state_version: 2, workspace_id: 3 }];
		const { prepared, c } = makeCanonDb(canonRows);
		const out = await emailService.applyCanonicalStates(c, [{ emailId: 10, folderKey: 'inbox', unread: 1 }], 1);

		const canonicalPrepares = prepared.filter(s => /mail_canonical_state/.test(s));
		expect(canonicalPrepares).toHaveLength(1);                       // V3: one canonical binding query
		expect(canonicalPrepares[0]).toContain('workspace_account_bindings'); // V2
		expect(prepared.some(s => /workspace_mailboxes/.test(s))).toBe(false); // V1/V6: no superseded query
		// V5/E7: canonical output unchanged (authoritative mapping applied)
		expect(out[0].canonicalStateMode).toBe('authoritative');
		expect(out[0].unread).toBe(0);        // is_read=1 -> unread 0
		expect(out[0].folderKey).toBe('inbox');
	});

	it('empty list short-circuits with no query', async () => {
		const { prepared, c } = makeCanonDb([]);
		const out = await emailService.applyCanonicalStates(c, [], 1);
		expect(out).toEqual([]);
		expect(prepared).toHaveLength(0);
	});
});

// ---------- F5: account.delete not-found contract + setAllReceive ----------
const h = vi.hoisted(() => ({ orm: [] }));
vi.mock('../../src/service/user-service.js', () => ({
	default: { selectById: vi.fn(async () => ({ userId: 1, email: 'me@example.com' })) }
}));
vi.mock('../../src/entity/orm.js', () => ({
	default: () => ({
		update: () => ({ set: () => ({ where: () => ({ run: async () => { h.orm.push('update'); } }) }) })
	})
}));
const { default: accountService } = await import('../../src/service/account-service.js');

const ctx = { env: { db: { prepare: () => ({ bind: () => ({ run: async () => ({}) }) }) } } };

describe('F5 account.delete not-found & ownership contract', () => {
	beforeEach(() => { h.orm.length = 0; vi.restoreAllMocks(); });

	it('missing account -> BizError 404, no deletion (V8/V9)', async () => {
		vi.spyOn(accountService, 'selectById').mockResolvedValue(undefined);
		await expect(accountService.delete(ctx, { accountId: 99 }, 1)).rejects.toMatchObject({ code: 404 });
		expect(h.orm).toHaveLength(0);
	});

	it('existing foreign account -> denied, no deletion (V10)', async () => {
		vi.spyOn(accountService, 'selectById').mockResolvedValue({ email: 'other@example.com', userId: 2 });
		await expect(accountService.delete(ctx, { accountId: 5 }, 1)).rejects.toBeTruthy();
		expect(h.orm).toHaveLength(0);
	});

	it('owned (non-primary) account -> normal delete flow (V11)', async () => {
		vi.spyOn(accountService, 'selectById').mockResolvedValue({ email: 'other@example.com', userId: 1, provider: 'cloudflare_native' });
		await expect(accountService.delete(ctx, { accountId: 5 }, 1)).resolves.toBeUndefined();
		expect(h.orm).toContain('update'); // soft-delete ran
	});
});

describe('F5 setAllReceive guard (V13/V15) & dead-var removal (V14)', () => {
	beforeEach(() => { h.orm.length = 0; vi.restoreAllMocks(); });

	it('missing account -> returns without any update (existing null guard intact)', async () => {
		vi.spyOn(accountService, 'selectByIdForUser').mockResolvedValue(undefined);
		await expect(accountService.setAllReceive(ctx, { accountId: 99 }, 1)).resolves.toBeUndefined();
		expect(h.orm).toHaveLength(0);
	});

	it('existing account -> two toggle updates run', async () => {
		vi.spyOn(accountService, 'selectByIdForUser').mockResolvedValue({ accountId: 5, userId: 1, allReceive: 0 });
		await accountService.setAllReceive(ctx, { accountId: 5 }, 1);
		expect(h.orm).toHaveLength(2);
	});
});
