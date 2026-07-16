// F3 logout session-integrity regression tests.
// Covers: null authInfo, missing token, single-token, multi-token, double
// logout, concurrent-representative sequences, and TTL preservation on write.
import { describe, expect, it, vi, beforeEach } from 'vitest';

import loginService, { removeSessionToken } from '../../src/service/login-service.js';
import constant from '../../src/const/constant.js';
import KvConst from '../../src/const/kv-const.js';

describe('removeSessionToken (pure) — F3 integrity', () => {
	it('V1: null authInfo does not throw and removes nothing', () => {
		expect(() => removeSessionToken(null, 'tok')).not.toThrow();
		expect(removeSessionToken(null, 'tok')).toEqual({ authInfo: null, removed: false });
	});

	it('V1: malformed authInfo (no tokens array) is safe', () => {
		expect(removeSessionToken({}, 'tok')).toEqual({ authInfo: null, removed: false });
	});

	it('V2: missing token removes NO session', () => {
		const authInfo = { tokens: ['a', 'b', 'c'] };
		const { removed } = removeSessionToken(authInfo, 'zzz');
		expect(removed).toBe(false);
		expect(authInfo.tokens).toEqual(['a', 'b', 'c']); // untouched, last token NOT evicted
	});

	it('V3: existing token removes only the target', () => {
		const authInfo = { tokens: ['a', 'b', 'c'] };
		const { removed } = removeSessionToken(authInfo, 'b');
		expect(removed).toBe(true);
		expect(authInfo.tokens).toEqual(['a', 'c']);
	});

	it('V3: removing first/last leaves the rest intact', () => {
		const first = { tokens: ['a', 'b', 'c'] };
		removeSessionToken(first, 'a');
		expect(first.tokens).toEqual(['b', 'c']);
		const last = { tokens: ['a', 'b', 'c'] };
		removeSessionToken(last, 'c');
		expect(last.tokens).toEqual(['a', 'b']);
	});

	it('V4: double logout of the same token evicts no other device', () => {
		const authInfo = { tokens: ['deviceA', 'deviceB'] };
		const first = removeSessionToken(authInfo, 'deviceA');
		expect(first.removed).toBe(true);
		expect(authInfo.tokens).toEqual(['deviceB']);
		// second logout re-uses the same token — already gone
		const second = removeSessionToken(authInfo, 'deviceA');
		expect(second.removed).toBe(false);
		expect(authInfo.tokens).toEqual(['deviceB']); // deviceB survives
	});

	it('V5: concurrent-representative sequence never drops a non-matching token', () => {
		const authInfo = { tokens: ['t1', 't2', 't3'] };
		// two logouts racing on t1 and t2 (applied sequentially on shared record)
		removeSessionToken(authInfo, 't1');
		removeSessionToken(authInfo, 't2');
		removeSessionToken(authInfo, 't1'); // stale replay of first
		expect(authInfo.tokens).toEqual(['t3']); // only t3 remains, nothing wrongly evicted
	});
});

describe('loginService.logout — KV lifecycle (F3)', () => {
	function makeContext(authInfoValue, { token }) {
		const puts = [];
		const c = {
			env: {
				kv: {
					async get(key) {
						return key === KvConst.AUTH_INFO + 42 ? authInfoValue : null;
					},
					async put(key, value, opts) {
						puts.push({ key, value: JSON.parse(value), opts });
					}
				}
			},
			// getToken reads via userContext -> readAuthToken(c) header, then verifyToken.
			req: { header: (n) => (String(n).toLowerCase() === 'authorization' ? token && `hdr` : undefined) }
		};
		return { c, puts };
	}

	beforeEach(() => vi.restoreAllMocks());

	it('V6: normal logout writes with 30-day TTL and removes only the target', async () => {
		// Stub token resolution to a known session id.
		const userContext = (await import('../../src/security/user-context.js')).default;
		vi.spyOn(userContext, 'getToken').mockResolvedValue('sessB');
		const authInfo = { user: { email: 'x@y.z' }, tokens: ['sessA', 'sessB', 'sessC'] };
		const { c, puts } = makeContext(authInfo, { token: 'sessB' });

		await loginService.logout(c, 42);

		expect(puts).toHaveLength(1);
		expect(puts[0].opts).toEqual({ expirationTtl: constant.TOKEN_EXPIRE });
		expect(constant.TOKEN_EXPIRE).toBe(60 * 60 * 24 * 30);
		expect(puts[0].value.tokens).toEqual(['sessA', 'sessC']);
	});

	it('V1: null authInfo logout does not throw and does not write', async () => {
		const userContext = (await import('../../src/security/user-context.js')).default;
		vi.spyOn(userContext, 'getToken').mockResolvedValue('sessX');
		const { c, puts } = makeContext(null, { token: 'sessX' });
		await expect(loginService.logout(c, 42)).resolves.toBeUndefined();
		expect(puts).toHaveLength(0);
	});

	it('V2/V4: logout of an absent token writes nothing (no eviction, TTL untouched)', async () => {
		const userContext = (await import('../../src/security/user-context.js')).default;
		vi.spyOn(userContext, 'getToken').mockResolvedValue('already-gone');
		const authInfo = { tokens: ['live1', 'live2'] };
		const { c, puts } = makeContext(authInfo, { token: 'already-gone' });
		await loginService.logout(c, 42);
		expect(puts).toHaveLength(0);       // no rewrite => existing KV TTL preserved
		expect(authInfo.tokens).toEqual(['live1', 'live2']);
	});
});
