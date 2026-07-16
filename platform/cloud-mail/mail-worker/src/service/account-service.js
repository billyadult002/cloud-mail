import BizError from '../error/biz-error';
import verifyUtils from '../utils/verify-utils';
import emailUtils from '../utils/email-utils';
import userService from './user-service';
import emailService from './email-service';
import orm from '../entity/orm';
import account from '../entity/account';
import { and, asc, eq, gt, inArray, count, sql, ne, or, lt, desc } from 'drizzle-orm';
import {accountConst, isDel, settingConst} from '../const/entity-const';
import settingService from './setting-service';
import turnstileService from './turnstile-service';
import roleService from './role-service';
import { t } from '../i18n/i18n';
import verifyRecordService from './verify-record-service';

const accountService = {

	async add(c, params, userId) {

		const { addEmailVerify , addEmail, manyEmail, addVerifyCount, minEmailPrefix, emailPrefixFilter } = await settingService.query(c);

		let { email, token } = params;


		if (!(addEmail === settingConst.addEmail.OPEN && manyEmail === settingConst.manyEmail.OPEN)) {
			throw new BizError(t('addAccountDisabled'));
		}


		if (!email) {
			throw new BizError(t('emptyEmail'));
		}

		if (!verifyUtils.isEmail(email)) {
			throw new BizError(t('notEmail'));
		}

		if (!c.env.domain.includes(emailUtils.getDomain(email))) {
			throw new BizError(t('notExistDomain'));
		}

		if (emailUtils.getName(email).length < minEmailPrefix) {
			throw new BizError(t('minEmailPrefix', { msg: minEmailPrefix } ));
		}

		if (emailPrefixFilter.some(content => emailUtils.getName(email).includes(content))) {
			throw new BizError(t('banEmailPrefix'));
		}

		let accountRow = await this.selectByEmailIncludeDel(c, email);

		if (accountRow && accountRow.isDel === isDel.DELETE) {
			throw new BizError(t('isDelAccount'));
		}

		if (accountRow) {
			throw new BizError(t('isRegAccount'));
		}

		const userRow = await userService.selectById(c, userId);
		const roleRow = await roleService.selectById(c, userRow.type);

		if (userRow.email !== c.env.admin) {

			if (roleRow.accountCount > 0) {
				const userAccountCount = await accountService.countUserAccount(c, userId)
				if(userAccountCount >= roleRow.accountCount) throw new BizError(t('accountLimit'), 403);
			}

			if(!roleService.hasAvailDomainPerm(roleRow.availDomain, email)) {
				throw new BizError(t('noDomainPermAdd'),403)
			}

		}

		let addVerifyOpen = false

		if (addEmailVerify === settingConst.addEmailVerify.OPEN) {
			addVerifyOpen = true
			await turnstileService.verify(c, token);
		}

		if (addEmailVerify === settingConst.addEmailVerify.COUNT) {
			addVerifyOpen = await verifyRecordService.isOpenAddVerify(c, addVerifyCount);
			if (addVerifyOpen) {
				await turnstileService.verify(c,token)
			}
		}


		accountRow = await orm(c).insert(account).values({
			email,
			userId,
			name: emailUtils.getName(email),
			provider: 'cloudflare_native',
			domain: emailUtils.getDomain(email),
			syncStatus: 'connected'
		}).returning().get();
		await this.upsertIdentity(c, accountRow.email, userId);

		if (addEmailVerify === settingConst.addEmailVerify.COUNT && !addVerifyOpen) {
			const row = await verifyRecordService.increaseAddCount(c);
			addVerifyOpen = row.count >= addVerifyCount
		}

		accountRow.addVerifyOpen = addVerifyOpen
		return accountRow;
	},

	selectByEmailIncludeDel(c, email) {
		return orm(c).select().from(account).where(sql`${account.email} COLLATE NOCASE = ${email}`).get();
	},

	async list(c, params, userId) {

		let { accountId, size, lastSort } = params;

		accountId = Number(accountId);
		size = Number(size);
		lastSort = Number(lastSort);

		if (Number.isNaN(size) || size <= 0) {
			size = 30;
		} else if (size > 30) {
			size = 30;
		}

		if (Number.isNaN(accountId) || accountId < 0) {
			accountId = 0;
		}

		if (Number.isNaN(lastSort)) {
			lastSort = 9999999999;
		}

		const { results } = await c.env.db.prepare(
			`WITH ranked AS (
			   SELECT a.*,
			          ROW_NUMBER() OVER (
			            PARTITION BY
			              CASE WHEN provider IN ('gmail','google_workspace') THEN LOWER(email) ELSE CAST(account_id AS TEXT) END
			            ORDER BY
			              CASE WHEN provider IN ('gmail','google_workspace') AND sync_status = 'mailbox_ready' THEN 0 ELSE 1 END,
			              CASE WHEN provider IN ('gmail','google_workspace') AND EXISTS (
			                SELECT 1 FROM mail_provider_credentials mpc
			                 WHERE mpc.user_id = a.user_id
			                   AND mpc.account_id = a.account_id
			                   AND mpc.provider IN ('gmail','google_workspace')
			                   AND COALESCE(mpc.credential_ciphertext, '') LIKE 'oauth-json:%'
			              ) THEN 0 ELSE 1 END,
			              datetime(COALESCE(last_synced_at, create_time, '1970-01-01')) DESC,
			              account_id DESC
			          ) AS canonical_rank
			     FROM account a
			    WHERE user_id = ?1
			      AND is_del = ?2
			      AND (
			        sort < ?3
			        OR (sort = ?3 AND account_id > ?4)
			      )
			 )
			 SELECT *
			   FROM ranked
			  WHERE canonical_rank = 1
			  ORDER BY sort DESC, account_id ASC
			  LIMIT ?5`
		).bind(userId, isDel.NORMAL, lastSort, accountId, size).all();
		return results || [];
	},

	async delete(c, params, userId) {

		let { accountId } = params;

		const user = await userService.selectById(c, userId);
		const accountRow = await this.selectById(c, accountId);

		if (accountRow.email === user.email) {
			throw new BizError(t('delMyAccount'));
		}

		if (accountRow.userId !== user.userId) {
			throw new BizError(t('noUserAccount'));
		}

		await orm(c).update(account).set({ isDel: isDel.DELETE }).where(
			and(eq(account.userId, userId),
				eq(account.accountId, accountId)))
			.run();

		if (accountRow.provider === 'gmail') {
			await c.env.db.prepare(
				`DELETE FROM mail_provider_credentials
				  WHERE user_id = ?1 AND account_id = ?2 AND provider = 'gmail'`
			).bind(userId, accountId).run();
		}
	},

	selectById(c, accountId) {
		return orm(c).select().from(account).where(
			and(eq(account.accountId, accountId),
				eq(account.isDel, isDel.NORMAL)))
			.get();
	},

	selectByIdForUser(c, accountId, userId) {
		return orm(c).select().from(account).where(
			and(eq(account.accountId, accountId),
				eq(account.userId, userId),
				eq(account.isDel, isDel.NORMAL)))
			.get();
	},

	async insert(c, params) {
		const email = String(params.email || '').trim().toLowerCase();
		const row = await orm(c).insert(account).values({
			provider: 'cloudflare_native',
			syncStatus: 'connected',
			...params,
			email,
			domain: params.domain || emailUtils.getDomain(email)
		}).returning().get();
		await this.upsertIdentity(c, row.email, row.userId);
		return row;
	},

	async upsertIdentity(c, email, userId) {
		const normalized = String(email || '').trim().toLowerCase();
		const domain = normalized.split('@')[1] || '';
		await c.env.db.prepare(
			`INSERT INTO email_identities
			 (email, normalized_email, domain, source, routing_enabled, user_id, status, last_synced_at)
			 VALUES (?1, ?1, ?2, 'cloudmail', 1, ?3, 'active', CURRENT_TIMESTAMP)
			 ON CONFLICT(normalized_email) DO UPDATE SET
			   user_id = excluded.user_id,
			   status = 'active',
			   routing_enabled = 1,
			   updated_at = CURRENT_TIMESTAMP`
		).bind(normalized, domain, userId).run();
	},

	async insertList(c, list) {
		await orm(c).insert(account).values(list).run();
	},

	async physicsDeleteByUserIds(c, userIds) {
		await emailService.physicsDeleteUserIds(c, userIds);
		await orm(c).delete(account).where(inArray(account.userId,userIds)).run();
	},

	async selectUserAccountCountList(c, userIds, del = isDel.NORMAL) {
		const result = await orm(c)
			.select({
				userId: account.userId,
				count: count(account.accountId)
			})
			.from(account)
			.where(and(
				inArray(account.userId, userIds),
				eq(account.isDel, del)
			))
			.groupBy(account.userId)
		return result;
	},

	async countUserAccount(c, userId) {
		const { num } = await orm(c).select({num: count()}).from(account).where(and(eq(account.userId, userId),eq(account.isDel, isDel.NORMAL))).get();
		return num;
	},

	async restoreByEmail(c, email) {
		await orm(c).update(account).set({isDel: isDel.NORMAL}).where(eq(account.email, email)).run();
	},

	async restoreByIdForUser(c, accountId, userId) {
		await orm(c).update(account).set({isDel: isDel.NORMAL}).where(
			and(eq(account.accountId, accountId), eq(account.userId, userId))
		).run();
	},

	async restoreByUserId(c, userId) {
		await orm(c).update(account).set({isDel: isDel.NORMAL}).where(eq(account.userId, userId)).run();
	},

	async setName(c, params, userId) {
		const { name, accountId } = params
		if (name.length > 30) {
			throw new BizError(t('usernameLengthLimit'));
		}
		await orm(c).update(account).set({name}).where(and(eq(account.userId, userId),eq(account.accountId, accountId))).run();
	},

	async allAccount(c, params) {

		let { userId, num, size } = params

		userId = Number(userId)

		num = Number(num)
		size = Number(size)

		if (size > 30) {
			size = 30;
		}

		num = (num - 1) * size;

		const userRow = await userService.selectByIdIncludeDel(c, userId);

		const list = await orm(c).select().from(account).where(and(eq(account.userId, userId),ne(account.email,userRow.email))).limit(size).offset(num);
		const { total } = await orm(c).select({ total: count() }).from(account).where(eq(account.userId, userId)).get();

		return { list, total }
	},

	async physicsDelete(c, params) {
		const { accountId } = params
		await emailService.physicsDeleteByAccountId(c, accountId)
		await orm(c).delete(account).where(eq(account.accountId, accountId)).run();
	},

	async setAllReceive(c, params, userId) {
		let a = null
		const { accountId } = params;
		const accountRow = await this.selectByIdForUser(c, accountId, userId);
		if (!accountRow) {
			return;
		}
		await orm(c).update(account).set({ allReceive: accountConst.allReceive.CLOSE }).where(eq(account.userId, userId)).run();
		await orm(c).update(account).set({ allReceive: accountRow.allReceive ? 0 : 1 }).where(
			and(eq(account.accountId, accountId), eq(account.userId, userId))
		).run();
	},

	async setAsTop(c, params, userId) {
		const { accountId } = params;
		const userRow = await userService.selectById(c, userId);
		const mainAccountRow = await accountService.selectByEmailIncludeDel(c, userRow.email);
		let mainSort = mainAccountRow.sort === 0 ? 2 : mainAccountRow.sort + 1;
		await orm(c).update(account).set({ sort: mainSort }).where(eq(account.email, userRow.email )).run();
		await orm(c).update(account).set({ sort: mainSort - 1 }).where(and(eq(account.accountId, accountId),eq(account.userId,userId))).run();
	}
};

export default accountService;
