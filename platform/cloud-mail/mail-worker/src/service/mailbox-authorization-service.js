import BizError from '../error/biz-error';
import cryptoUtils from '../utils/crypto-utils';
import userService from './user-service';

function normalizeEmail(value) {
	return String(value || '').trim().toLowerCase();
}

async function audit(c, userId, action, outcome, metadata = {}) {
	await c.env.db.prepare(
		`INSERT INTO audit_logs (user_id, actor_role, action, resource_type, outcome, metadata_json)
		 VALUES (?1, 'user', ?2, 'mailbox_authorization', ?3, ?4)`
	).bind(userId, action, outcome, JSON.stringify(metadata)).run();
}

const mailboxAuthorizationService = {
	async authorize(c, granteeUserId, params = {}) {
		const email = normalizeEmail(params.email);
		const password = String(params.password || '');
		if (!email || !password) throw new BizError('Mailbox email and password are required.', 400);

		const grantee = await userService.selectById(c, granteeUserId);
		if (!grantee) throw new BizError('Session expired.', 401);
		let owner = await userService.selectByEmail(c, email);
		let ownerAccount = null;
		if (!owner) {
			ownerAccount = await c.env.db.prepare(
				`SELECT account_id, user_id, email, provider, sync_status
				   FROM account
				  WHERE email = ?1 COLLATE NOCASE
				    AND provider = 'cloudflare_native' AND is_del = 0
				  LIMIT 1`
			).bind(email).first();
			if (ownerAccount) {
				owner = await userService.selectById(c, ownerAccount.user_id);
			}
		}
		if (!owner) throw new BizError('CloudMail mailbox account does not exist or is inactive.', 404);
		if (owner.userId === granteeUserId) throw new BizError('This mailbox already belongs to the current profile.', 400);
		if (!await cryptoUtils.verifyPassword(password, owner.salt, owner.password)) {
			await audit(c, granteeUserId, 'mailbox_authorization_failed', 'failed', { email, reason: 'invalid_owner_password' });
			throw new BizError('Mailbox authorization failed. Check the mailbox password and try again.', 403);
		}

		if (!ownerAccount) ownerAccount = await c.env.db.prepare(
			`SELECT account_id, email, provider, sync_status
			   FROM account
			  WHERE user_id = ?1 AND email = ?2 COLLATE NOCASE
			    AND provider = 'cloudflare_native' AND is_del = 0
			  LIMIT 1`
		).bind(owner.userId, email).first();
		if (!ownerAccount) throw new BizError('CloudMail mailbox owner account is missing.', 409);

		const inserted = await c.env.db.prepare(
			`INSERT INTO mailbox_authorizations
			 (grantee_user_id, owner_user_id, owner_account_id, email, provider, status, authorization_method, last_authorized_at)
			 VALUES (?1, ?2, ?3, ?4, 'cloudflare_native', 'active', 'owner_password', CURRENT_TIMESTAMP)
			 ON CONFLICT(grantee_user_id, provider, email) WHERE status = 'active' AND revoked_at IS NULL
			 DO UPDATE SET
			   owner_user_id = excluded.owner_user_id,
			   owner_account_id = excluded.owner_account_id,
			   status = 'active',
			   authorization_method = 'owner_password',
			   last_authorized_at = CURRENT_TIMESTAMP,
			   revoked_at = NULL,
			   updated_at = CURRENT_TIMESTAMP`
		).bind(granteeUserId, owner.userId, ownerAccount.account_id, email).run();

		await audit(c, granteeUserId, 'mailbox_authorized', 'success', {
			email,
			ownerUserId: owner.userId,
			ownerAccountId: ownerAccount.account_id
		});
		return {
			id: inserted.meta?.last_row_id || null,
			email,
			provider: 'cloudflare_native',
			status: 'active',
			authorizationMethod: 'owner_password',
			currentUserChanged: false,
			ownerUserId: owner.userId,
			ownerAccountId: ownerAccount.account_id
		};
	},

	async list(c, granteeUserId) {
		const rows = await c.env.db.prepare(
			`SELECT id,
			        grantee_user_id,
			        owner_user_id,
			        owner_account_id,
			        email,
			        provider,
			        status,
			        authorization_method,
			        last_authorized_at,
			        created_at,
			        updated_at
			   FROM mailbox_authorizations
			  WHERE grantee_user_id = ?1 AND status = 'active' AND revoked_at IS NULL
			  ORDER BY email`
		).bind(granteeUserId).all();
		return rows.results || [];
	},

	async revoke(c, granteeUserId, id) {
		const grantId = Number(id);
		if (!grantId) throw new BizError('Mailbox authorization id is required.', 400);
		const grant = await c.env.db.prepare(
			`SELECT id, email FROM mailbox_authorizations
			  WHERE id = ?1 AND grantee_user_id = ?2 AND status = 'active' AND revoked_at IS NULL`
		).bind(grantId, granteeUserId).first();
		if (!grant) throw new BizError('Mailbox authorization not found.', 404);
		await c.env.db.prepare(
			`UPDATE mailbox_authorizations
			    SET status = 'revoked', revoked_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
			  WHERE id = ?1 AND grantee_user_id = ?2`
		).bind(grantId, granteeUserId).run();
		await audit(c, granteeUserId, 'mailbox_authorization_revoked', 'success', { email: grant.email });
		return { id: grantId, status: 'revoked', currentUserChanged: false };
	}
};

export default mailboxAuthorizationService;
