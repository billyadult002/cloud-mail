// F1 security repair regression test.
// Verifies that publicService.addUser builds its INSERTs with D1 bound
// parameters (?n) instead of interpolating request-controlled values
// (email, roleName-derived type, os/browser/device from User-Agent, active_ip)
// into the SQL string. A single-quote email that would have broken the old
// template-literal SQL must now flow through bind() unchanged.
import { describe, expect, it, vi, beforeEach } from 'vitest';

// Deterministic collaborators so addUser reaches the SQL-building path.
vi.mock('../../src/utils/verify-utils.js', () => ({
	default: { isEmail: () => true }
}));
vi.mock('../../src/utils/crypto-utils.js', () => ({
	default: {
		hashPassword: async () => ({ salt: 'SALT', hash: 'HASH' }),
		genRandomPwd: () => 'randpwd12',
		genHashPassword: async () => 'HASH',
		verifyPassword: async () => true,
		generateSalt: () => 'SALT'
	}
}));
vi.mock('../../src/utils/req-utils.js', () => ({
	default: {
		getIp: () => '1.2.3.4',
		// browser intentionally carries a single quote to prove the UA-derived
		// values are bound, not concatenated.
		getUserAgent: () => ({ os: 'iOS17', browser: "Saf'ari", device: 'iPhone' })
	}
}));
vi.mock('../../src/service/role-service.js', () => ({
	default: {
		roleSelectUse: async () => [
			{ roleId: 1, name: 'default-role', isDefault: 1 },
			{ roleId: 7, name: 'admin-role', isDefault: 0 }
		]
	}
}));

const { default: publicService } = await import('../../src/service/public-service.js');

function makeCapturingContext() {
	const statements = [];
	const db = {
		prepare(sql) {
			const stmt = {
				sql,
				args: undefined,
				bind(...a) { this.args = a; return this; }
			};
			return stmt;
		},
		async batch(list) {
			for (const s of list) statements.push({ sql: s.sql, args: s.args });
			return list.map(() => ({ success: true }));
		}
	};
	return {
		statements,
		c: { env: { db, domain: ['example.com'] } }
	};
}

function userInsert(statements) {
	return statements.find(s => /INSERT INTO user\b/.test(s.sql));
}
function accountInsert(statements) {
	return statements.find(s => /INSERT INTO account\b/.test(s.sql));
}

describe('publicService.addUser parameterization (F1)', () => {
	beforeEach(() => vi.clearAllMocks());

	it('binds a normal email and never interpolates values into SQL', async () => {
		const { statements, c } = makeCapturingContext();
		await publicService.addUser(c, {
			list: [{ email: 'alice@example.com', password: 'secret12' }]
		});

		const u = userInsert(statements);
		const a = accountInsert(statements);
		expect(u).toBeTruthy();
		expect(a).toBeTruthy();

		// No template interpolation and no quoted-literal VALUES survived.
		for (const s of statements) {
			expect(s.sql).not.toContain('${');
			expect(s.sql).not.toMatch(/VALUES\s*\(\s*'/);
		}
		expect(u.sql).toMatch(/\?1/);
		expect(u.sql).toMatch(/\?9/);

		// user insert bound args: email, hash, salt, type, os, browser, ip, device, time
		expect(u.args.slice(0, 8)).toEqual([
			'alice@example.com', 'HASH', 'SALT', 1, 'iOS17', "Saf'ari", '1.2.3.4', 'iPhone'
		]);
		expect(typeof u.args[8]).toBe('string');
		expect(u.args[8]).toMatch(/^\d{4}-\d{2}-\d{2}/);

		// account insert bound args: email, localpart
		expect(a.args).toEqual(['alice@example.com', 'alice']);
	});

	it('handles a single-quote email via bind() without breaking SQL', async () => {
		const { statements, c } = makeCapturingContext();
		const trickyEmail = "o'brien@example.com";
		await expect(
			publicService.addUser(c, { list: [{ email: trickyEmail, password: 'secret12' }] })
		).resolves.toBeUndefined();

		const u = userInsert(statements);
		const a = accountInsert(statements);
		// The quote is preserved verbatim in the bound value, not escaped into SQL.
		expect(u.args[0]).toBe(trickyEmail);
		expect(a.args[0]).toBe(trickyEmail);
		expect(a.args[1]).toBe("o'brien");
		// SQL text itself contains no quote-delimited value.
		expect(u.sql).not.toContain("'");
		expect(a.sql).not.toContain("'");
	});

	it('keeps roleName compatibility by binding the resolved role id', async () => {
		const { statements, c } = makeCapturingContext();
		await publicService.addUser(c, {
			list: [{ email: 'bob@example.com', password: 'secret12', roleName: 'admin-role' }]
		});
		const u = userInsert(statements);
		expect(u.args[3]).toBe(7); // resolved from roleName, bound (not interpolated)
	});

	it('emits the static account backfill UPDATE with no bound external input', async () => {
		const { statements, c } = makeCapturingContext();
		await publicService.addUser(c, {
			list: [{ email: 'carol@example.com', password: 'secret12' }]
		});
		const update = statements.find(s => /UPDATE account SET user_id/.test(s.sql));
		expect(update).toBeTruthy();
		expect(update.sql).not.toContain('${');
		expect(update.args).toBeUndefined();
	});
});
