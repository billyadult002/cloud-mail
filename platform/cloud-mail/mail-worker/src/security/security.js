import BizError from '../error/biz-error';
import constant from '../const/constant';
import jwtUtils from '../utils/jwt-utils';
import KvConst from '../const/kv-const';
import dayjs from 'dayjs';
import userService from '../service/user-service';
import permService from '../service/perm-service';
import { t } from '../i18n/i18n'
import app from '../hono/hono';
import { readAuthToken } from './token-transport';

const exclude = [
	'/login',
	'/register',
	'/forgot-password',
	'/reset-password',
	'/auth/email-discovery',
	'/auth/provisioning-handoff',
	'/auth/activate',
	'/secure/',
	'/setting/websiteConfig',
	'/webhooks',
	'/init',
	'/public/genToken',
	'/telegram',
	'/oauth',
	'/ai/oauth/gemini/callback'
];

const premKey = {
	'email:delete': ['/email/delete'],
	'email:send': ['/email/send'],
	'account:add': ['/account/add'],
	'account:query': ['/account/list'],
	'account:delete': ['/account/delete'],
	'my:delete': ['/my/delete'],
	'role:add': ['/role/add'],
	'role:set': ['/role/set','/role/setDefault'],
	'role:query': ['/role/list', '/role/tree'],
	'role:delete': ['/role/delete'],
	'user:query': ['/user/list','/user/allAccount'],
	'google-test-users:query': [
		'GET /v2/admin/google-test-user-requests',
		'GET /v2/admin/google-test-user-requests/dashboard',
		'GET /v2/admin/google-test-user-requests/gmail-list',
		'GET /v2/admin/google-test-user-requests/report.md',
		'GET /v2/admin/google-test-user-requests/export.csv'
	],
	'google-test-users:write': [
		'POST /v2/admin/google-test-user-requests/approve-all',
		'POST /v2/admin/google-test-user-requests/status',
		'POST /v2/admin/google-test-user-requests/google-synced'
	],
	'delivery:query': [
		'GET /v2/admin/delivery/events',
		'GET /v2/admin/delivery/summary',
		'GET /v2/admin/delivery/retry-backlog',
		'GET /v2/admin/delivery/failure-rollup'
	],
	'user:add': ['/user/add'],
	'user:reset-send': ['/user/resetSendCount'],
	'user:set-pwd': ['/user/setPwd'],
	'user:set-status': ['/user/setStatus', '/user/restore'],
	'user:set-type': ['/user/setType'],
	'user:delete': ['/user/delete','/user/deleteAccount'],
	'all-email:query': ['/allEmail/list','/allEmail/latest'],
	'all-email:delete': ['/allEmail/delete','/allEmail/batchDelete'],
	'setting:query': ['/setting/query'],
	'setting:set': ['/setting/set', '/setting/setBackground','/setting/deleteBackground','/setting/setBlacklist'],
	'analysis:query': ['/analysis/echarts'],
	'reg-key:add': ['/regKey/add'],
	'reg-key:query': ['/regKey/list','/regKey/history'],
	'reg-key:delete': ['/regKey/delete','/regKey/clearNotUse'],
};

const routePerms = [
	['POST', '/email/send', 'email:send'],
	['DELETE', '/email/delete', 'email:delete'],
	['GET', '/account/list', 'account:query'],
	['DELETE', '/account/delete', 'account:delete'],
	['POST', '/account/add', 'account:add'],
	['DELETE', '/my/delete', 'my:delete'],
	['GET', '/analysis/echarts', 'analysis:query'],
	['POST', '/role/add', 'role:add'],
	['GET', '/role/list', 'role:query'],
	['GET', '/role/tree', 'role:query'],
	['DELETE', '/role/delete', 'role:delete'],
	['PUT', '/role/set', 'role:set'],
	['PUT', '/role/setDefault', 'role:set'],
	['GET', '/allEmail/list', 'all-email:query'],
	['GET', '/allEmail/latest', 'all-email:query'],
	['DELETE', '/allEmail/delete', 'all-email:delete'],
	['DELETE', '/allEmail/batchDelete', 'all-email:delete'],
	['PUT', '/setting/setBackground', 'setting:set'],
	['DELETE', '/setting/deleteBackground', 'setting:set'],
	['PUT', '/setting/set', 'setting:set'],
	['GET', '/setting/query', 'setting:query'],
	['PUT', '/setting/setBlacklist', 'setting:set'],
	['DELETE', '/user/delete', 'user:delete'],
	['PUT', '/user/setPwd', 'user:set-pwd'],
	['PUT', '/user/setStatus', 'user:set-status'],
	['PUT', '/user/setType', 'user:set-type'],
	['GET', '/user/list', 'user:query'],
	['PUT', '/user/restore', 'user:set-status'],
	['PUT', '/user/resetSendCount', 'user:reset-send'],
	['POST', '/user/add', 'user:add'],
	['DELETE', '/user/deleteAccount', 'user:delete'],
	['GET', '/user/allAccount', 'user:query'],
	['GET', '/v2/admin/google-test-user-requests', 'google-test-users:query'],
	['GET', '/v2/admin/google-test-user-requests/dashboard', 'google-test-users:query'],
	['GET', '/v2/admin/google-test-user-requests/gmail-list', 'google-test-users:query'],
	['GET', '/v2/admin/google-test-user-requests/report.md', 'google-test-users:query'],
	['GET', '/v2/admin/google-test-user-requests/export.csv', 'google-test-users:query'],
	['POST', '/v2/admin/google-test-user-requests/approve-all', 'google-test-users:write'],
	['POST', '/v2/admin/google-test-user-requests/status', 'google-test-users:write'],
	['POST', '/v2/admin/google-test-user-requests/google-synced', 'google-test-users:write'],
	['GET', '/v2/admin/delivery/events', 'delivery:query'],
	['GET', '/v2/admin/delivery/summary', 'delivery:query'],
	['GET', '/v2/admin/delivery/retry-backlog', 'delivery:query'],
	['GET', '/v2/admin/delivery/failure-rollup', 'delivery:query'],
	['POST', '/regKey/add', 'reg-key:add'],
	['GET', '/regKey/list', 'reg-key:query'],
	['GET', '/regKey/history', 'reg-key:query'],
	['DELETE', '/regKey/delete', 'reg-key:delete'],
	['DELETE', '/regKey/clearNotUse', 'reg-key:delete']
].map(([method, path, perm]) => ({ method, path, perm }));

const DENY_PERMISSION = '__deny__';

export function pathMatchesRoute(path, route) {
	const normalizedRoute = route.length > 1 ? route.replace(/\/+$/, '') : route;
	return path === normalizedRoute || path.slice(0, normalizedRoute.length + 1) === `${normalizedRoute}/`;
}

export function requiredPermForRoute(method, path) {
	const upperMethod = String(method || 'GET').toUpperCase();
	const match = routePerms.find(route => route.method === upperMethod && pathMatchesRoute(path, route.path));
	if (match?.perm) return match.perm;
	if (pathMatchesRoute(path, '/v2/admin/google-test-user-requests')) return DENY_PERMISSION;
	if (pathMatchesRoute(path, '/v2/admin/delivery')) return DENY_PERMISSION;
	return null;
}

export function permissionAllowsRoute(permKeys, method, path) {
	const requiredPerm = requiredPermForRoute(method, path);
	if (!requiredPerm) return true;
	if (requiredPerm === DENY_PERMISSION) return false;
	return Array.isArray(permKeys) && permKeys.includes(requiredPerm);
}

async function assertGovernanceScope(c, path, authInfo) {
	if (path === '/v3/domains/onboarding/plan') return;
	const governedPath = pathMatchesRoute(path, '/v2/p31') ||
		pathMatchesRoute(path, '/v2/p32c') ||
		pathMatchesRoute(path, '/v2/security/lifecycle') ||
		pathMatchesRoute(path, '/v2/security/secure-links') ||
		pathMatchesRoute(path, '/v3/domains');
	if (!governedPath) return;
	const adminEmail = String(c.env.admin || '').trim().toLowerCase();
	const userEmail = String(authInfo.user?.email || '').trim().toLowerCase();
	if (adminEmail && userEmail === adminEmail) return;

	const domainMatch = path.match(/\/domains\/([^/]+)/i) || path.match(/\/lifecycle\/([^/]+)/i);
	const requestedDomain = domainMatch ? decodeURIComponent(domainMatch[1]).trim().toLowerCase().replace(/^@+/, '').replace(/\.$/, '') : null;
	if (!requestedDomain && pathMatchesRoute(path, '/v3/domains')) return;
	if (!requestedDomain) throw new BizError(t('unauthorized'), 403);
	const userDomain = userEmail.split('@')[1] || '';
	if (userDomain === requestedDomain) return;
	const owned = await c.env.db.prepare(
		`SELECT 1 FROM account
		  WHERE user_id = ?1 AND is_del = 0 AND lower(COALESCE(domain, '')) = ?2
		  LIMIT 1`
	).bind(authInfo.user.userId, requestedDomain).first();
	if (!owned) throw new BizError(t('unauthorized'), 403);
}

app.use('*', async (c, next) => {

	const path = c.req.path;
	const method = c.req.method;

	const index = exclude.findIndex(item => {
		return pathMatchesRoute(path, item);
	});

	if (index > -1) {
		return await next();
	}

	if (pathMatchesRoute(path, '/public')) {

		const userPublicToken = await c.env.kv.get(KvConst.PUBLIC_KEY);
		const publicToken = c.req.header(constant.TOKEN_HEADER);
		if (publicToken !== userPublicToken) {
			throw new BizError(t('publicTokenFail'), 401);
		}
		return await next();
	}


	// Dual-read: Authorization header (legacy) or httpOnly cookie (hardened).
	const jwt = readAuthToken(c);

	const result = await jwtUtils.verifyToken(c, jwt);

	if (!result) {
		throw new BizError(t('authExpired'), 401);
	}

	const { userId, token } = result;
	const authInfo = await c.env.kv.get(KvConst.AUTH_INFO + userId, { type: 'json' });

	if (!authInfo) {
		throw new BizError(t('authExpired'), 401);
	}

	if (!authInfo.tokens.includes(token)) {
		throw new BizError(t('authExpired'), 401);
	}

	await assertGovernanceScope(c, path, authInfo);

	const requiredPerm = requiredPermForRoute(method, path);

	if (requiredPerm) {

		const permKeys = await permService.userPermKeys(c, authInfo.user.userId);

		if (!permissionAllowsRoute(permKeys, method, path) && authInfo.user.email !== c.env.admin) {
			throw new BizError(t('unauthorized'), 403);
		}

	}

	const refreshTime = dayjs(authInfo.refreshTime).startOf('day');
	const nowTime = dayjs().startOf('day')

	if (!nowTime.isSame(refreshTime)) {
		authInfo.refreshTime = dayjs().toISOString();
		await userService.updateUserInfo(c, authInfo.user.userId);
		await c.env.kv.put(KvConst.AUTH_INFO + userId, JSON.stringify(authInfo), { expirationTtl: constant.TOKEN_EXPIRE });
	}

	c.set('user',authInfo.user)

	return await next();
});
