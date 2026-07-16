import orm from '../entity/orm';
import email from '../entity/email';
import { attConst, emailConst, isDel, settingConst } from '../const/entity-const';
import { and, desc, eq, gt, inArray, lt, count, asc, sql, ne, or, like, lte, gte } from 'drizzle-orm';
import { star } from '../entity/star';
import settingService from './setting-service';
import accountService from './account-service';
import BizError from '../error/biz-error';
import emailUtils from '../utils/email-utils';
import fileUtils from '../utils/file-utils';
import { Resend } from 'resend';
import attService from './att-service';
import { parseHTML } from 'linkedom';
import userService from './user-service';
import roleService from './role-service';
import user from '../entity/user';
import starService from './star-service';
import dayjs from 'dayjs';
import kvConst from '../const/kv-const';
import { t } from '../i18n/i18n'
import domainUtils from '../utils/domain-uitls';
import account from "../entity/account";
import { att } from '../entity/att';
import telegramService from './telegram-service';
import outboundService from './outbound-service';
import { OutboundStatus } from './outbound-state';
import { buildFtsQuery } from '../utils/fts-utils';
import geminiOAuthService from './gemini-oauth-service';

const GMAIL_SEND_TIMEOUT_MS = 12000;

function parseCanonicalJSON(value) {
	try {
		const parsed = JSON.parse(value || '[]');
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

async function fetchWithTimeout(url, options = {}, timeoutMs = GMAIL_SEND_TIMEOUT_MS) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort('gmail_send_timeout'), timeoutMs);
	try {
		return await fetch(url, { ...options, signal: controller.signal });
	} catch (error) {
		if (error?.name === 'AbortError' || String(error?.message || error).toLowerCase().includes('abort')) {
			const err = new BizError('Gmail REST send timed out before provider acceptance.', 504);
			err.reason = 'gmail_send_timeout';
			throw err;
		}
		throw error;
	} finally {
		clearTimeout(timer);
	}
}

function normalizeRecipientList(value) {
	if (Array.isArray(value)) {
		return value.map(item => String(item || '').trim().toLowerCase()).filter(Boolean);
	}
	if (typeof value === 'string') {
		return value
			.split(/[,\n;\t]+/)
			.map(item => item.trim().toLowerCase())
			.filter(Boolean);
	}
	if (value == null) return [];
	return [String(value).trim().toLowerCase()].filter(Boolean);
}

const emailService = {
	async applyCanonicalStates(c, list, userId) {
		if (!Array.isArray(list) || list.length === 0) return list;
		const ids = [...new Set(list.map(item => Number(item.emailId)).filter(Number.isInteger))];
		if (ids.length === 0) return list;
		const placeholders = ids.map((_, index) => `?${index + 2}`).join(',');
		let rows;
		try {
			rows = (await c.env.db.prepare(`SELECT s.* FROM mail_canonical_state s JOIN workspace_mailboxes wm ON wm.workspace_id=s.workspace_id AND wm.account_id=s.account_id JOIN workspace_members m ON m.workspace_id=s.workspace_id AND m.user_id=?1 WHERE s.tenant_id=?1 AND s.message_id IN (${placeholders}) ORDER BY s.state_version DESC`).bind(userId, ...ids).all()).results || [];
			rows = (await c.env.db.prepare(`SELECT s.* FROM mail_canonical_state s JOIN workspace_account_bindings wb ON wb.workspace_id=s.workspace_id AND wb.account_id=s.account_id AND wb.subject_user_id=s.tenant_id AND wb.lifecycle_state='READY' JOIN workspace_members m ON m.workspace_id=wb.workspace_id AND m.user_id=?1 WHERE s.tenant_id=?1 AND s.message_id IN (${placeholders}) ORDER BY s.state_version DESC`).bind(userId, ...ids).all()).results || [];
		} catch (error) {
			// Observable compatibility window before migration 0044. The old state
			// remains readable, but canonical mutations are not enabled yet.
			return list.map(item => ({ ...item, canonicalStateMode: 'compatibility_unavailable' }));
		}
		const byMessage = new Map();
		for (const row of rows) if (!byMessage.has(Number(row.message_id))) byMessage.set(Number(row.message_id), row);
		return list.map(item => {
			const state = byMessage.get(Number(item.emailId));
			if (!state) {
				return { ...item, canonicalStateMode: 'compatibility_projected', stateVersion: 1 };
			}
			return {
				...item,
				providerFolderKey: item.folderKey || 'inbox',
				isStar: Number(state.is_starred),
				unread: state.is_read ? 0 : 1,
				folderKey: state.folder_key,
				semanticCategory: state.semantic_category,
				isPriority: Boolean(state.is_priority),
				isVip: Boolean(state.is_vip),
				junkDisposition: state.junk_disposition,
				overlays: parseCanonicalJSON(state.overlays_json),
				tags: parseCanonicalJSON(state.tags_json),
				stateVersion: Number(state.state_version),
				canonicalWorkspaceId: Number(state.workspace_id),
				canonicalStateMode: 'authoritative'
			};
		});
	},

	async list(c, params, userId) {

		let { emailId, type, accountId, size, timeSort, allReceive, provider } = params;

		size = Number(size);
		emailId = Number(emailId);
		timeSort = Number(timeSort);
		accountId = Number(accountId);
		allReceive = Number(allReceive);

		if (Number.isNaN(size) || size <= 0) {
			size = 30;
		} else if (size > 50) {
			size = 50;
		}

		if (Number.isNaN(emailId) || emailId <= 0) {
			emailId = timeSort ? 0 : 9999999999;
		}

		if (Number.isNaN(accountId) || accountId < 0) {
			accountId = 0;
		}

		const delegatedAuthorization = accountId && !allReceive
			? await this.delegatedMailboxAuthorization(c, userId, accountId)
			: null;
		const mailOwnerUserId = delegatedAuthorization?.owner_user_id || userId;
		const delegatedAccountRow = delegatedAuthorization
			? await accountService.selectById(c, accountId)
			: null;

		if (isNaN(allReceive)) {
			let accountRow = await accountService.selectByIdForUser(c, accountId, userId);
			allReceive = accountRow?.allReceive || 0;
		}

		const allReceiveScopeCondition = allReceive
			? await this.allReceiveMailboxScopeCondition(c, userId)
			: null;
		const accountScopeCondition = allReceive
			? allReceiveScopeCondition
			: and(eq(email.accountId, accountId), eq(email.userId, mailOwnerUserId));

		const workspaceBoundCanonicalFolder = `COALESCE((SELECT s.folder_key FROM mail_canonical_state s JOIN workspace_account_bindings swb ON swb.workspace_id=s.workspace_id AND swb.account_id=s.account_id AND swb.subject_user_id=s.tenant_id AND swb.lifecycle_state='READY' JOIN workspace_members sm ON sm.workspace_id=swb.workspace_id AND sm.user_id=?1 WHERE s.tenant_id=?1 AND s.account_id=e.account_id AND s.message_id=e.email_id ORDER BY s.state_version DESC LIMIT 1),NULLIF(e.folder_key,''),CASE WHEN e.is_del!=0 THEN 'trash' ELSE 'inbox' END)`;
		const effectiveCanonicalFolder = workspaceBoundCanonicalFolder;
		const conditions = [
			accountScopeCondition,
			timeSort ? gt(email.emailId, emailId) : lt(email.emailId, emailId),
			eq(email.type, type),
			eq(email.isDel, isDel.NORMAL)
		];

		if (provider) {
			conditions.push(eq(email.provider, String(provider)));
		}

		const countConditions = [
			accountScopeCondition,
			eq(email.type, type),
			eq(email.isDel, isDel.NORMAL)
		];

		if (provider) {
			countConditions.push(eq(email.provider, String(provider)));
		}

		const query = orm(c)
			.select({
				...email,
				starId: star.starId,
				accountEmailFromAccount: account.email,
				accountProvider: account.provider,
				accountDomainFromAccount: account.domain,
				accountSyncStatus: account.syncStatus
			})
			.from(email)
			.leftJoin(
				star,
				and(
					eq(star.emailId, email.emailId),
					eq(star.userId, userId)
				)
			).leftJoin(
				account,
				and(
					eq(account.accountId, email.accountId),
					eq(account.userId, email.userId)
				)
			)
			.where(and(...conditions));

		if (timeSort) {
			query.orderBy(asc(email.emailId));
		} else {
			query.orderBy(desc(email.emailId));
		}

		const listQuery = query.limit(size).all();

		// WF-8 / WP-D: the count filters only on `email` columns, so the previous
		// leftJoin on `account` was pure overhead. Removing it lets the count be
		// served by email_inbox_idx (0012) alone.
		const totalQuery = orm(c).select({ total: count() }).from(email)
			.where(and(...countConditions)).get();

		const latestEmailQuery = orm(c).select().from(email).where(
			and(
				accountScopeCondition,
				eq(email.type, type),
				eq(email.isDel, isDel.NORMAL),
				provider ? eq(email.provider, String(provider)) : eq(1,1)
			))
			.orderBy(desc(email.emailId)).limit(1).get();

		let [list, totalRow, latestEmail] = await Promise.all([listQuery, totalQuery, latestEmailQuery]);

		list = list.map(item => this.withSourceTruth({
			...item,
			isStar: item.starId != null ? 1 : 0
		}));
		list = await this.applyCanonicalStates(c, list, userId);


		await this.emailAddAtt(c, list);

		if (!latestEmail) {
			latestEmail = {
				emailId: 0,
				accountId: accountId,
				userId: userId,
				accountEmail: delegatedAccountRow?.email,
				provider: delegatedAccountRow?.provider,
				accountDomain: delegatedAccountRow?.domain,
				accountSyncStatus: delegatedAccountRow?.syncStatus,
			}
		}

		return { list, total: totalRow.total, latestEmail };
	},

	async delegatedMailboxAuthorization(c, userId, accountId) {
		return c.env.db.prepare(
			`SELECT grantee_user_id, owner_user_id, owner_account_id, email, provider
			   FROM mailbox_authorizations
			  WHERE grantee_user_id = ?1
			    AND owner_account_id = ?2
			    AND status = 'active'
			    AND revoked_at IS NULL
			  LIMIT 1`
		).bind(userId, accountId).first();
	},

	async allReceiveMailboxScopeCondition(c, userId) {
		const grants = await c.env.db.prepare(
			`SELECT owner_user_id, owner_account_id
			   FROM mailbox_authorizations
			  WHERE grantee_user_id = ?1
			    AND status = 'active'
			    AND revoked_at IS NULL`
		).bind(userId).all();
		const scopes = [eq(email.userId, userId)];
		for (const grant of grants.results || []) {
			const ownerUserId = Number(grant.owner_user_id);
			const ownerAccountId = Number(grant.owner_account_id);
			if (!ownerUserId || !ownerAccountId) continue;
			scopes.push(and(
				eq(email.userId, ownerUserId),
				eq(email.accountId, ownerAccountId)
			));
		}
		return scopes.length === 1 ? scopes[0] : or(...scopes);
	},

	withSourceTruth(item) {
		const accountEmail = item.accountEmail || item.accountEmailFromAccount || item.toEmail || '';
		const provider = item.provider || item.accountProvider || 'cloudflare_native';
		const accountDomain = item.accountDomain || item.accountDomainFromAccount || String(accountEmail).split('@')[1] || '';
		const stableMessageId = item.messageId || item.externalMessageId || (item.emailId ? `email:${item.emailId}` : '');
		const ledger = this.withGlobalLedgerFields({
			...item,
			accountEmail,
			provider,
			accountDomain,
			threadId: item.threadId || item.inReplyTo || item.relation || stableMessageId,
			externalMessageId: item.externalMessageId || stableMessageId
		});
		return {
			...ledger,
			provider,
			accountEmail,
			accountDomain,
			threadId: item.threadId || item.inReplyTo || item.relation || stableMessageId,
			externalMessageId: item.externalMessageId || stableMessageId
		};
	},

	withGlobalLedgerFields(item) {
		const numericType = Number(item.type ?? 0);
		const numericStatus = Number(item.status ?? 0);
		const isDeleted = Number(item.isDel ?? item.is_del ?? 0) !== isDel.NORMAL;
		const toEmail = item.toEmail ?? item.to_email ?? '';
		const accountEmail = item.accountEmail || item.accountEmailFromAccount || toEmail || '';
		const attachmentCount = Number(item.attachmentCount ?? item.attachment_count ?? item.attCount ?? 0);
		const stableMessageId = item.messageId || item.externalMessageId || (item.emailId ? `email:${item.emailId}` : '');
		const direction = numericType === emailConst.type.SEND ? 'outbound' : 'inbound';
		let folder = item.folderKey || item.folder_key || (direction === 'outbound' ? 'sent' : 'inbox');
		if (isDeleted) folder = 'trash';
		let status = direction === 'outbound' ? 'sent_recorded' : 'received';
		let deliveryTruthState = direction === 'outbound' ? 'sent_recorded' : 'received_confirmed';
		if (direction === 'outbound') {
			if ([emailConst.status.SENT, emailConst.status.DELIVERED].includes(numericStatus)) {
				status = numericStatus === emailConst.status.DELIVERED ? 'receipt_pending' : 'provider_accepted';
				deliveryTruthState = numericStatus === emailConst.status.DELIVERED ? 'provider_reported_delivered' : 'provider_accepted_not_delivered';
			} else if ([emailConst.status.BOUNCED, emailConst.status.COMPLAINED, emailConst.status.DELAYED].includes(numericStatus)) {
				status = 'failed';
				deliveryTruthState = 'failed_or_delayed';
			}
		}
		const cc = item.ccRecipients || item.cc || '';
		const emailId = item.emailId ?? item.email_id;
		const sendEmail = item.sendEmail ?? item.send_email;
		const toName = item.toName ?? item.to_name ?? '';
		const accountId = item.accountId ?? item.account_id;
		const createTime = item.createTime ?? item.create_time;
		const isStar = item.isStar ?? item.is_star ?? 0;
		const externalMessageId = item.externalMessageId ?? item.external_message_id ?? stableMessageId;

		return {
			...item,
			emailId,
			email_id: emailId,
			sendEmail,
			send_email: sendEmail,
			toEmail,
			to_email: toEmail,
			toName,
			to_name: toName,
			accountId,
			account_id: accountId,
			createTime,
			create_time: createTime,
			isStar,
			is_star: isStar,
			messageId: stableMessageId,
			message_id: stableMessageId,
			threadId: item.threadId || item.inReplyTo || item.relation || stableMessageId,
			thread_id: item.threadId || item.inReplyTo || item.relation || stableMessageId,
			identityId: item.identityId || accountId,
			identity_id: item.identityId || accountId,
			mailboxEmail: accountEmail,
			mailbox_email: accountEmail,
			provider: item.provider || item.accountProvider || 'cloudflare_native',
			direction,
			folder,
			status,
			subject: item.subject || '',
			from: sendEmail || '',
			to: toEmail || '',
			cc,
			date: createTime || item.date || '',
			hasAttachments: attachmentCount > 0,
			has_attachments: attachmentCount > 0,
			attachmentCount,
			attachment_count: attachmentCount,
			sourceFolder: folder,
			source_folder: folder,
			syncState: item.accountSyncStatus || item.syncState || 'indexed',
			sync_state: item.accountSyncStatus || item.syncState || 'indexed',
			deliveryTruthState,
			delivery_truth_state: deliveryTruthState,
			externalMessageId,
			external_message_id: externalMessageId
		};
	},

	async globalLedgerList(c, params, userId) {
		let { emailId, size, timeSort, provider, accountId, keyword, direction, folder, status, hasAttachment } = params;
		size = Math.min(Math.max(Number(size || 50), 1), 50);
		emailId = Number(emailId || (Number(timeSort) ? 0 : 9999999999));
		timeSort = Number(timeSort);
		const values = [userId, userId, userId];
		const workspaceBoundCanonicalFolder = `COALESCE((SELECT s.folder_key FROM mail_canonical_state s JOIN workspace_account_bindings swb ON swb.workspace_id=s.workspace_id AND swb.account_id=s.account_id AND swb.subject_user_id=s.tenant_id AND swb.lifecycle_state='READY' JOIN workspace_members sm ON sm.workspace_id=swb.workspace_id AND sm.user_id=?1 WHERE s.tenant_id=?1 AND s.account_id=e.account_id AND s.message_id=e.email_id ORDER BY s.state_version DESC LIMIT 1),NULLIF(e.folder_key,''),CASE WHEN e.is_del!=0 THEN 'trash' ELSE 'inbox' END)`;
		const effectiveCanonicalFolder = workspaceBoundCanonicalFolder;
		const conditions = [
			folder === 'trash' ? `${effectiveCanonicalFolder} = 'trash'` : `${effectiveCanonicalFolder} != 'trash'`,
			`e.status != ?3`,
			timeSort ? `e.email_id > ?4` : `e.email_id < ?4`,
			`(
				(e.type = 0 AND (e.user_id = ?1 OR EXISTS (
					SELECT 1 FROM mailbox_authorizations ma
					 WHERE ma.grantee_user_id = ?2
					   AND ma.owner_user_id = e.user_id
					   AND ma.owner_account_id = e.account_id
					   AND ma.status = 'active'
					   AND ma.revoked_at IS NULL
				)))
				OR (e.type = 1 AND e.user_id = ?1)
			)`
		];
		values[2] = emailConst.status.SAVING;
		values.push(emailId);
		if (provider) {
			values.push(String(provider));
			conditions.push(`e.provider = ?${values.length}`);
		}
		if (accountId) {
			values.push(Number(accountId));
			conditions.push(`e.account_id = ?${values.length}`);
		}
		if (direction) {
			if (direction === 'inbound') conditions.push(`e.type = 0`);
			if (direction === 'outbound') conditions.push(`e.type = 1`);
		}
		if (folder) {
			if (folder === 'inbox') conditions.push(`e.type = 0 AND ${effectiveCanonicalFolder} = 'inbox'`);
			if (folder === 'sent') conditions.push(`e.type = 1`);
			if (!['inbox', 'sent', 'trash'].includes(folder)) {
				values.push(String(folder));
				conditions.push(`${effectiveCanonicalFolder} = ?${values.length}`);
			}
		}
		if (status) {
			if (status === 'received') conditions.push(`e.type = 0`);
			if (status === 'provider_accepted' || status === 'sent_recorded' || status === 'receipt_pending') conditions.push(`e.type = 1`);
			if (status === 'failed') conditions.push(`e.status IN (3, 4, 5, 8)`);
		}
		if (keyword) {
			values.push(`%${String(keyword)}%`);
			const idx = values.length;
			conditions.push(`(
				e.subject LIKE ?${idx} COLLATE NOCASE
				OR e.send_email LIKE ?${idx} COLLATE NOCASE
				OR e.to_email LIKE ?${idx} COLLATE NOCASE
				OR e.account_email LIKE ?${idx} COLLATE NOCASE
				OR a.email LIKE ?${idx} COLLATE NOCASE
			)`);
		}
		if (String(hasAttachment || '') === '1') {
			conditions.push(`EXISTS (SELECT 1 FROM attachments x WHERE x.email_id = e.email_id)`);
		}
		const where = conditions.join('\n AND ');
		const order = timeSort ? 'ASC' : 'DESC';
		const listSql = `
			SELECT e.email_id AS emailId,
			       e.send_email AS sendEmail,
			       e.name AS name,
			       e.account_id AS accountId,
			       e.user_id AS userId,
			       e.subject AS subject,
			       e.text AS text,
			       e.content AS content,
			       e.cc AS cc,
			       e.bcc AS bcc,
			       e.to_email AS toEmail,
			       e.to_name AS toName,
			       e.in_reply_to AS inReplyTo,
			       e.relation AS relation,
			       e.message_id AS messageId,
			       e.type AS type,
			       e.status AS rawStatus,
			       e.status AS status,
			       e.unread AS unread,
			       e.provider AS provider,
			       COALESCE(NULLIF(e.account_email, ''), a.email, e.to_email) AS accountEmail,
			       COALESCE(NULLIF(e.account_domain, ''), a.domain, '') AS accountDomain,
			       COALESCE(NULLIF(e.thread_id, ''), e.in_reply_to, e.relation, e.message_id, 'email:' || e.email_id) AS threadId,
			       COALESCE(NULLIF(e.external_message_id, ''), e.message_id, 'email:' || e.email_id) AS externalMessageId,
			       e.folder_key AS folderKey,
			       e.create_time AS createTime,
			       e.is_del AS isDel,
			       a.provider AS accountProvider,
			       a.sync_status AS accountSyncStatus,
			       (SELECT COUNT(1) FROM attachments x WHERE x.email_id = e.email_id) AS attachmentCount
			  FROM email e
			  LEFT JOIN account a ON a.account_id = e.account_id AND a.user_id = e.user_id
			 WHERE ${where}
			 ORDER BY e.email_id ${order}
			 LIMIT ?${values.length + 1}`;
		const countSql = `
			SELECT COUNT(1) AS total
			  FROM email e
			  LEFT JOIN account a ON a.account_id = e.account_id AND a.user_id = e.user_id
			 WHERE ${where}`;
		const listPromise = c.env.db.prepare(listSql).bind(...values, size).all();
		const countPromise = c.env.db.prepare(countSql).bind(...values).first();
		let [listResult, totalRow] = await Promise.all([listPromise, countPromise]);
		let list = (listResult.results || []).map(item => this.withGlobalLedgerFields(item));
		list = await this.applyCanonicalStates(c, list, userId);
		await this.emailAddAtt(c, list);
		list = list.map(item => this.withGlobalLedgerFields(item));
		const latestEmail = list[0]
			? {
				emailId: list[0].emailId,
				accountId: list[0].accountId,
				userId: list[0].userId,
				accountEmail: list[0].accountEmail,
				provider: list[0].provider,
				createTime: list[0].createTime
			}
			: { emailId: 0, accountId: 0, userId };
		return {
			list,
			total: Number(totalRow?.total || list.length),
			latestEmail
		};
	},

	async delete(c, params, userId) {
		const { emailIds } = params;
		const emailIdList = emailIds.split(',').map(Number);
		await orm(c).update(email).set({ isDel: isDel.DELETE, folderKey: 'trash' }).where(
			and(
				eq(email.userId, userId),
				inArray(email.emailId, emailIdList)))
			.run();
	},

	async move(c, params, userId) {
		const allowed = new Set(['inbox','needsReply','todo','followUp','important','starred','junk','trash','done','snoozed']);
		const folder = String(params.folder || '').trim();
		const emailIds = Array.isArray(params.emailIds) ? params.emailIds.map(Number).filter(Number.isInteger) : [];
		if (!allowed.has(folder) || emailIds.length === 0) throw new Error('Invalid mail move request.');
		const deleted = folder === 'trash' ? isDel.DELETE : isDel.NORMAL;
		await orm(c).update(email).set({ folderKey: folder, isDel: deleted }).where(
			and(eq(email.userId, userId), inArray(email.emailId, emailIds))).run();
	},

	receive(c, params, cidAttList, r2domain) {
		params.content = this.imgReplace(params.content, cidAttList, r2domain)
		return orm(c).insert(email).values({ ...params }).returning().get();
	},

	//邮件发送
	async send(c, params, userId) {

		let {
			accountId, //发送账号id
			name, //发件人名字
			sendType, //发件类型
			emailId, //邮件id，如果是回复邮件会带
				receiveEmail, //收件人邮箱
				cc = [],
				bcc = [],
				text, //邮件纯文本
				content, //邮件内容
				subject, //邮件标题
				idempotencyKey, //幂等键 (WF-4)
				attachments = [] //附件
			} = params;

			receiveEmail = normalizeRecipientList(receiveEmail);
			cc = normalizeRecipientList(cc);
			bcc = normalizeRecipientList(bcc);
			attachments = Array.isArray(attachments) ? attachments : [];
			const allRecipients = [...receiveEmail, ...cc, ...bcc];
			if (allRecipients.length === 0) {
				throw new BizError('At least one valid recipient is required.', 400);
			}

			const { resendTokens, r2Domain, send, domainList } = await settingService.query(c);

		let { imageDataList, html } = await attService.toImageUrlHtml(c, content);

		//判断是否关闭发件功能
		if (send === settingConst.send.CLOSE) {
			throw new BizError(t('disabledSend'), 403);
		}

		const userRow = await userService.selectById(c, userId);
		const roleRow = await roleService.selectById(c, userRow.type);

			//判断接收方是不是全部为站内邮箱
			const allInternal = allRecipients.every(email => {
				const domain = '@' + emailUtils.getDomain(email);
				return domainList.includes(domain);
			});

		if (c.env.admin !== userRow.email) {

			//发件被禁用
			if (roleRow.sendType === 'ban') {
				throw new BizError(t('bannedSend'), 403);
			}

			//发件被禁用
			if (roleRow.sendType === 'internal' && !allInternal) {
				throw new BizError(t('onlyInternalSend'), 403);
			}

		}

		//如果不是管理员，权限设置了发送次数
		if (c.env.admin !== userRow.email && roleRow.sendCount) {

			if (userRow.sendCount >= roleRow.sendCount) {
				if (roleRow.sendType === 'day') throw new BizError(t('daySendLimit'), 403);
				if (roleRow.sendType === 'count') throw new BizError(t('totalSendLimit'), 403);
			}

				if (userRow.sendCount + allRecipients.length > roleRow.sendCount) {
				if (roleRow.sendType === 'day') throw new BizError(t('daySendLack'), 403);
				if (roleRow.sendType === 'count') throw new BizError(t('totalSendLack'), 403);
			}

		}

		const accountRow = await accountService.selectById(c, accountId);

		if (!accountRow) {
			throw new BizError(t('senderAccountNotExist'));
		}

		if (accountRow.userId !== userId) {
			const delegatedSend = await c.env.db.prepare(
				`SELECT id
				   FROM mailbox_authorizations
				  WHERE grantee_user_id = ?1
				    AND owner_account_id = ?2
				    AND status = 'active'
				    AND revoked_at IS NULL
				    AND authorization_method = 'owner_password'
				  LIMIT 1`
			).bind(userId, accountId).first();
			if (!delegatedSend) {
				throw new BizError(t('sendEmailNotCurUser'));
			}
		}

		const sendCapableProviders = new Set(['gmail', 'google_workspace', 'cloudflare_native']);
		const accountProvider = accountRow.provider || 'cloudflare_native';
		if (String(accountRow.syncStatus || '').toLowerCase().includes('send_scope_missing')) {
			throw new BizError('Reconnect required for send', 403);
		}
		if (!sendCapableProviders.has(accountProvider)) {
			throw new BizError(t('noSendProvider'), 403);
		}

		if (c.env.admin !== userRow.email) {
			//用户没有这个域名的使用权限
			if(!roleService.hasAvailDomainPerm(roleRow.availDomain, accountRow.email)) {
				throw new BizError(t('noDomainPermSend'),403)
			}

		}

		// --- Durable send: idempotency claim (WF-4 / WP-A) ---
		// Collapse accidental double-submits and enable retry without dupes.
		const outboundKey = await outboundService.resolveKey({
			accountId, receiveEmail, cc, bcc, subject, text, content, idempotencyKey
		}, userId);
		const claim = await outboundService.claim(c, userId, accountId, outboundKey);
		if (claim.replay) {
			// Already sent for this key — return the prior result, no re-send.
			const priorEmail = claim.row?.email_id
				? await this.selectById(c, claim.row.email_id)
				: null;
			return priorEmail ? [this.withSourceTruth(priorEmail)] : [];
		}
		if (claim.inflight) {
			throw new BizError(t('sendEmailNotCurUser') || 'A send with this key is already in progress.', 409);
		}
		if (claim.dead) {
			throw new BizError(claim.row?.last_error || 'Send retry limit reached.', 422);
		}
		const outboundId = claim.id;
		const outboundAttempts = Number(claim.row?.attempts || 1);
		// Payload used to reconstruct a retry if the provider transiently fails.
		// Keep the ORIGINAL idempotency inputs (params) so resolveKey() derives the
		// same hashed key on retry and re-matches this outbound record — never
		// double-hash the already-hashed outboundKey.
		const retryPayload = { ...params, accountId, userId };

		const domain = emailUtils.getDomain(accountRow.email);
		const resendToken = resendTokens[domain];
		const useCloudflareEmail = !!c.env.email;
		const usesProviderNativeSend = accountProvider === 'gmail' || accountProvider === 'google_workspace';

		// Provider-native senders (Gmail/Google Workspace) use their own REST API
		// and must not be blocked by Cloudflare Email or Resend configuration.
		if (!usesProviderNativeSend && !useCloudflareEmail && !resendToken && !allInternal) {
			throw new BizError(t('noSendProvider'));
		}

		//没有发件人名字自动截取
		if (!name) {
			name = emailUtils.getName(accountRow.email);
		}

		let emailRow = {
			messageId: null
		};

		//如果是回复邮件
		if (sendType === 'reply') {

			emailRow = await this.selectByIdForUser(c, emailId, userId);

			if (!emailRow) {
				throw new BizError(t('notExistEmailReply'));
			}

		}

		let sendResult = {};

		//存在站外邮箱时，如果配置了 Cloudflare Email Service 就优先使用，否则使用 Resend
		// Provider call is wrapped so a transient failure schedules a retry
		// (backoff) via the delivery state machine instead of losing the send.
		if (!allInternal) {

			try {
				if (usesProviderNativeSend) {
					sendResult = await this.sendByGmailREST(c, userId, accountId, {
						name,
						accountEmail: accountRow.email,
						receiveEmail,
						cc,
						bcc,
						subject,
						text,
						html,
						attachments: [...imageDataList, ...attachments],
						sendType,
						messageId: emailRow.messageId
					});
				} else if (useCloudflareEmail) {
					sendResult = await this.sendByCloudflareEmail(c, {
						name,
						accountEmail: accountRow.email,
							receiveEmail,
							cc,
							bcc,
							subject,
						text,
						html,
						attachments: [...imageDataList, ...attachments],
						sendType,
						messageId: emailRow.messageId
					});
				} else {
					sendResult = await this.sendByResend(resendToken, {
						name,
						accountEmail: accountRow.email,
							receiveEmail,
							cc,
							bcc,
							subject,
						text,
						html,
						attachments: [...imageDataList, ...attachments],
						sendType,
						messageId: emailRow.messageId
					});
				}

				// Provider returned an error object (not a throw).
				if (sendResult?.error) {
					const err = sendResult.error;
					err.status = err.status || err.statusCode;
					throw err;
				}
			} catch (providerError) {
				const plan = await outboundService.markFailure(
					c, outboundId, outboundAttempts, providerError, retryPayload
				);
				if (plan.status === OutboundStatus.RETRY) {
					// Accepted for retry — surface a non-fatal status to the caller.
					return [{ status: emailConst.status.SAVING, queuedForRetry: true, outboundId }];
				}
				// Permanent failure.
				throw new BizError(String(providerError?.message || providerError).slice(0, 200), Number(providerError?.status) || 500);
			}

		}

		const { data } = sendResult;

		imageDataList = imageDataList.map(item => ({...item, contentId: `<${item.contentId}>`}))

		//把图片标签cid标签切换会通用url
		html = this.imgReplace(html, imageDataList, r2Domain);

		//封装数据保存到数据库
		const emailData = {};
		emailData.sendEmail = accountRow.email;
		emailData.name = name;
		emailData.subject = subject;
		emailData.content = html;
		emailData.text = text;
		emailData.accountId = accountId;
		emailData.provider = accountRow.provider || 'cloudflare_native';
		emailData.accountEmail = accountRow.email;
		emailData.accountDomain = accountRow.domain || emailUtils.getDomain(accountRow.email);
		emailData.threadId = emailRow.messageId || '';
		emailData.externalMessageId = data?.id || '';
		// Provider acceptance is not recipient delivery. Only an entirely
		// internal handoff has local persistence evidence strong enough to mark
		// delivered; external providers transition via their verified webhook.
		emailData.status = allInternal ? emailConst.status.DELIVERED : emailConst.status.SENT;
		emailData.type = emailConst.type.SEND;
		emailData.userId = userId;
		emailData.resendEmailId = data?.id;

		const recipient = [];

		receiveEmail.forEach(item => {
			recipient.push({ address: item, name: '' });
		});

			emailData.recipient = JSON.stringify(recipient);
			emailData.cc = JSON.stringify(cc.map(item => ({ address: item, name: '' })));
			emailData.bcc = JSON.stringify(bcc.map(item => ({ address: item, name: '' })));

		if (sendType === 'reply') {
			emailData.inReplyTo = emailRow.messageId;
			emailData.relation = emailRow.messageId;
		}

		//如果权限有发送次数增加用户发送次数
		if (roleRow.sendCount && roleRow.sendType !== 'internal') {
				await userService.incrUserSendCount(c, allRecipients.length, userId);
		}

		//保存到数据库并返回结果
		const emailResult = await orm(c).insert(email).values(emailData).returning().get();

		// Durable send: mark the outbound record delivered + link the email row.
		await outboundService.markSent(c, outboundId, emailResult.emailId, emailData.externalMessageId, {
			userId,
			accountId,
			provider: emailData.provider,
			attempt: outboundAttempts,
			delivered: allInternal,
			deliveryEvidence: allInternal ? 'internal_recipient_persistence_completed' : null
		});

		//保存内嵌附件
		if (imageDataList.length > 0) {
			if (imageDataList.length > 10) {
				throw new BizError(t('imageAttLimit'));
			}
			await attService.saveArticleAtt(c, imageDataList, userId, accountId, emailResult.emailId);
		}

		//保存普通附件
		if (attachments?.length > 0) {
			if (attachments.length > 10) {
				throw new BizError(t('attLimit'));
			}
			await attService.saveSendAtt(c, attachments, userId, accountId, emailResult.emailId);
		}

		const attList = await attService.selectByEmailIds(c, [emailResult.emailId]);
		emailResult.attList = attList;

		//如果全是站内接收方，直接写入数据库
		if (allInternal) {
			await this.HandleOnSiteEmail(c, receiveEmail, emailResult, attList);
		}

		const dateStr = dayjs().format('YYYY-MM-DD');
		let daySendTotal = await c.env.kv.get(kvConst.SEND_DAY_COUNT + dateStr);

		//记录每天发件次数统计
		if (!daySendTotal) {
				await c.env.kv.put(kvConst.SEND_DAY_COUNT + dateStr, JSON.stringify(allRecipients.length), { expirationTtl: 60 * 60 * 24 });
			} else  {
				daySendTotal = Number(daySendTotal) + allRecipients.length
			await c.env.kv.put(kvConst.SEND_DAY_COUNT + dateStr, JSON.stringify(daySendTotal), { expirationTtl: 60 * 60 * 24 });
		}

		return [ emailResult ];
	},

	async sendByCloudflareEmail(c, params) {
			const sendForm = {
				from: { email: params.accountEmail, name: params.name },
				to: [...params.receiveEmail],
				subject: params.subject
			};
			if (params.cc?.length) sendForm.cc = [...params.cc];
			if (params.bcc?.length) sendForm.bcc = [...params.bcc];

		if (params.text) {
			sendForm.text = params.text;
		}

		if (params.html) {
			sendForm.html = params.html;
		}

		const attachments = await this.toCloudflareAttachments(params.attachments);
		if (attachments.length > 0) {
			sendForm.attachments = attachments;
		}

		if (params.sendType === 'reply' && params.messageId) {
			sendForm.headers = {
				'in-reply-to': params.messageId,
				'references': params.messageId
			};
		}

		const result = await c.env.email.send(sendForm);

		return {
			data: {
				id: result.messageId
			}
		};
	},

	async sendByResend(resendToken, params) {
		const resend = new Resend(resendToken);

			const sendForm = {
				from: `${params.name} <${params.accountEmail}>`,
				to: [...params.receiveEmail],
				subject: params.subject,
				text: params.text,
				html: params.html,
				attachments: await this.toResendAttachments(params.attachments)
			};
			if (params.cc?.length) sendForm.cc = [...params.cc];
			if (params.bcc?.length) sendForm.bcc = [...params.bcc];

		if (params.sendType === 'reply') {
			sendForm.headers = {
				'in-reply-to': params.messageId,
				'references': params.messageId
			};
		}

		return await resend.emails.send(sendForm);
	},

	async sendByGmailREST(c, userId, accountId, params) {
		const accessToken = await geminiOAuthService.getValidMailboxAccessToken(c, userId, accountId);
		const boundary = 'cloudmail_send_boundary_' + Date.now();
		let mime = '';
		mime += `From: ${params.name} <${params.accountEmail}>\r\n`;
		mime += `To: ${params.receiveEmail.join(', ')}\r\n`;
		if (params.cc?.length) mime += `Cc: ${params.cc.join(', ')}\r\n`;
		if (params.bcc?.length) mime += `Bcc: ${params.bcc.join(', ')}\r\n`;

		const encodedSubject = btoa(unescape(encodeURIComponent(params.subject || '')));
		mime += `Subject: =?utf-8?B?${encodedSubject}?=\r\n`;
		mime += `MIME-Version: 1.0\r\n`;

		if (params.sendType === 'reply' && params.messageId) {
			mime += `In-Reply-To: ${params.messageId}\r\n`;
			mime += `References: ${params.messageId}\r\n`;
		}

		const hasAttachments = params.attachments?.length > 0;
		if (hasAttachments) {
			mime += `Content-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n`;

			const innerBoundary = 'inner_' + boundary;
			mime += `--${boundary}\r\n`;
			mime += `Content-Type: multipart/alternative; boundary="${innerBoundary}"\r\n\r\n`;

			mime += `--${innerBoundary}\r\n`;
			mime += `Content-Type: text/plain; charset="UTF-8"\r\n`;
			mime += `Content-Transfer-Encoding: base64\r\n\r\n`;
			mime += btoa(unescape(encodeURIComponent(params.text || ''))) + '\r\n\r\n';

			mime += `--${innerBoundary}\r\n`;
			mime += `Content-Type: text/html; charset="UTF-8"\r\n`;
			mime += `Content-Transfer-Encoding: base64\r\n\r\n`;
			mime += btoa(unescape(encodeURIComponent(params.html || ''))) + '\r\n\r\n';

			mime += `--${innerBoundary}--\r\n`;

			for (const attachment of params.attachments) {
				const base64Content = await this.toAttachmentBase64(attachment);
				if (!base64Content) continue;
				const filename = attachment.filename || 'attachment';
				const mimeType = attachment.contentType || attachment.mimeType || attachment.type || 'application/octet-stream';
				const disposition = attachment.contentId ? `inline; filename="${filename}"` : `attachment; filename="${filename}"`;

				mime += `--${boundary}\r\n`;
				mime += `Content-Type: ${mimeType}; name="${filename}"\r\n`;
				mime += `Content-Transfer-Encoding: base64\r\n`;
				mime += `Content-Disposition: ${disposition}\r\n`;
				if (attachment.contentId) {
					const cid = attachment.contentId.replace(/^<|>$/g, '');
					mime += `Content-ID: <${cid}>\r\n`;
				}
				mime += `\r\n`;
				const chunks = base64Content.match(/.{1,76}/g) || [base64Content];
				mime += chunks.join('\r\n') + '\r\n\r\n';
			}
			mime += `--${boundary}--`;
		} else {
			mime += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n`;

			mime += `--${boundary}\r\n`;
			mime += `Content-Type: text/plain; charset="UTF-8"\r\n`;
			mime += `Content-Transfer-Encoding: base64\r\n\r\n`;
			mime += btoa(unescape(encodeURIComponent(params.text || ''))) + '\r\n\r\n';

			mime += `--${boundary}\r\n`;
			mime += `Content-Type: text/html; charset="UTF-8"\r\n`;
			mime += `Content-Transfer-Encoding: base64\r\n\r\n`;
			mime += btoa(unescape(encodeURIComponent(params.html || ''))) + '\r\n\r\n';

			mime += `--${boundary}--`;
		}

		const raw = btoa(unescape(encodeURIComponent(mime)))
			.replace(/\+/g, '-')
			.replace(/\//g, '_')
			.replace(/=+$/g, '');

		const response = await fetchWithTimeout('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({ raw })
		});

		const body = await response.json().catch(() => ({}));
		if (!response.ok) {
			const reason = body.error?.status || body.error?.reason || body.error?.message || `http_${response.status}`;
			const err = new BizError(`Gmail REST send failed: ${reason}`, response.status);
			err.reason = reason;
			throw err;
		}

		return {
			data: {
				id: body.id
			}
		};
	},

	async toCloudflareAttachments(attachments) {
		const arrayBufferAttachments = await this.toArrayBufferAttachments(attachments);

		return arrayBufferAttachments.map(attachment => {
			const item = {
				content: attachment.content,
				filename: attachment.filename,
				type: attachment.mimeType || attachment.contentType || attachment.type || 'application/octet-stream',
				disposition: attachment.contentId ? 'inline' : 'attachment'
			};

			if (attachment.contentId) {
				item.contentId = attachment.contentId.replace(/^<|>$/g, '');
			}

			return item;
		});
	},

	async toResendAttachments(attachments = []) {
		const result = [];

		for (const attachment of attachments) {
			const content = await this.toAttachmentBase64(attachment);
			if (!content) {
				continue;
			}

			result.push({
				...attachment,
				content,
				contentType: attachment.contentType || attachment.mimeType || attachment.type || 'application/octet-stream'
			});
		}

		return result;
	},

	async toArrayBufferAttachments(attachments = []) {
		const result = [];

		for (const attachment of attachments) {
			const content = await this.toAttachmentArrayBuffer(attachment);
			if (!content) {
				continue;
			}

			result.push({ ...attachment, content });
		}

		return result;
	},

	async toAttachmentBase64(attachment) {
		let content = attachment.content;

		if (!content) {
			return null;
		}

		if (typeof content === 'string') {
			if (content.startsWith('data:')) {
				content = content.split(',')[1] || content;
			}
			return content.replace(/\s+/g, '');
		}

		const arrayBuffer = await this.toAttachmentArrayBuffer(attachment);
		if (!arrayBuffer) {
			return null;
		}

		const bytes = new Uint8Array(arrayBuffer);
		let binary = '';

		for (let i = 0; i < bytes.length; i += 0x8000) {
			binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
		}

		return btoa(binary);
	},

	async toAttachmentArrayBuffer(attachment) {
		let content = attachment.content;

		if (!content) {
			return null;
		}

		if (content instanceof ArrayBuffer) {
			return content;
		}

		if (content instanceof Uint8Array) {
			return content.buffer.slice(content.byteOffset, content.byteOffset + content.byteLength);
		}

		if (typeof content === 'string') {
			if (content.startsWith('data:')) {
				content = content.split(',')[1] || content;
			}
			return fileUtils.base64ToUint8Array(content.replace(/\s+/g, '')).buffer;
		}

		return content;
	},

	//处理站内邮件发送
	async HandleOnSiteEmail(c, receiveEmail, sendEmailData, attList) {

		const { noRecipient  } = await settingService.query(c);

		//查询所有收件人账号信息
		let accountList = await orm(c).select().from(account).where(inArray(account.email, receiveEmail)).all();

		//查询所有收件人权限身份
		const userIds = accountList.map(accountRow => accountRow.userId);
		let roleList = await roleService.selectByUserIds(c, userIds);

		//封装数据库准备保存到数据库
		const emailDataList = [];

		for (const email of receiveEmail) {

			//把发件人邮件改成收件
			const emailValues = {...sendEmailData}
			emailValues.status = emailConst.status.RECEIVE;
			emailValues.type = emailConst.type.RECEIVE;
			emailValues.toEmail = email;
			emailValues.toName = emailUtils.getName(email);
			emailValues.emailId = null;

			const accountRow = accountList.find(accountRow => accountRow.email === email);

			//如果收件人存在就把邮件信息改成收件人的
			if (accountRow) {

				//设置给收件人保存
				emailValues.userId = accountRow.userId;
				emailValues.accountId = accountRow.accountId;
				emailValues.provider = accountRow.provider || 'cloudflare_native';
				emailValues.accountEmail = accountRow.email;
				emailValues.accountDomain = accountRow.domain || emailUtils.getDomain(accountRow.email);
				emailValues.type = emailConst.type.RECEIVE;
				emailValues.status = emailConst.status.RECEIVE;

				const roleRow = roleList.find(roleRow => roleRow.userId === accountRow.userId);

				let { banEmail, availDomain } = roleRow;

				//如果收件人没有这个域名的使用权限和有邮件拦截，就把邮件改为拒收状态
				if (email !== c.env.admin) {

					if (!roleService.hasAvailDomainPerm(availDomain, email)) {
						emailValues.status = emailConst.status.BOUNCED;
						emailValues.message = `The recipient <${email}> is not authorized to use this domain.`;
					} else if(roleService.isBanEmail(banEmail, sendEmailData.sendEmail)) {
						emailValues.status = emailConst.status.BOUNCED;
						emailValues.message = `The recipient <${email}> is disabled from receiving emails.`;
					}

				}

				emailDataList.push(emailValues);

			} else {

				//设置无收件人邮件信息
				emailValues.userId = 0;
				emailValues.accountId = 0;
				emailValues.type = emailConst.type.RECEIVE;
				emailValues.status = emailConst.status.NOONE;

				//如果无人收件关闭改为拒收
				if (noRecipient === settingConst.noRecipient.CLOSE) {
					emailValues.status = emailConst.status.BOUNCED;
					emailValues.message = `Recipient not found: <${email}>`;
				}

				emailDataList.push(emailValues);

			}

		}

		//保存邮件
		const receiveEmailList = emailDataList.filter(emailRow => emailRow.status === emailConst.status.RECEIVE || emailRow.status === emailConst.status.NOONE);

		for (const emailData of receiveEmailList) {

			const emailRow = await orm(c).insert(email).values(emailData).returning().get();

			//设置附件保存
			for (const attRow of attList) {
				const attValues = {...attRow};
				attValues.emailId = emailRow.emailId;
				attValues.accountId = emailRow.accountId;
				attValues.userId = emailRow.userId;
				attValues.attId = null;
				await orm(c).insert(att).values(attValues).run();
			}

		}

		const bouncedEmail = emailDataList.find(emailRow => emailRow.status === emailConst.status.BOUNCED);


		let status = emailConst.status.DELIVERED;
		let message = ''
		//如果有拒收邮件，就把发件人的邮件改成拒收
		if (bouncedEmail) {
			const messageJson = { message: bouncedEmail.message };
			message = JSON.stringify(messageJson);
			status = emailConst.status.BOUNCED;
		}

		await orm(c).update(email).set({ status, message: message }).where(eq(email.emailId, sendEmailData.emailId)).run();

	},

	imgReplace(content, cidAttList, r2domain) {

		if (!content) {
			return ''
		}

		const { document } = parseHTML(content);

		const images = Array.from(document.querySelectorAll('img'));

		const useAtts = []

		for (const img of images) {

			const src = img.getAttribute('src');
			if (src && src.startsWith('cid:') && cidAttList) {

				const cid = src.replace(/^cid:/, '');
				const attCidIndex = cidAttList.findIndex(cidAtt => cidAtt.contentId.replace(/^<|>$/g, '') === cid);

				if (attCidIndex > -1) {
					const cidAtt = cidAttList[attCidIndex];
					img.setAttribute('src', '{{domain}}' + cidAtt.key);
					useAtts.push(cidAtt)
				}

			}

			r2domain = domainUtils.toOssDomain(r2domain)

			if (src && src.startsWith(r2domain + '/')) {
				img.setAttribute('src', src.replace(r2domain + '/', '{{domain}}'));
			}

		}

		useAtts.forEach(att => {
			att.type = attConst.type.EMBED
		})

		return document.toString();
	},

	selectById(c, emailId) {
		return orm(c).select().from(email).where(
			and(eq(email.emailId, emailId),
				eq(email.isDel, isDel.NORMAL)))
			.get();
	},

	selectByIdForUser(c, emailId, userId) {
		return orm(c).select().from(email).where(
			and(eq(email.emailId, emailId),
				eq(email.userId, userId),
				eq(email.isDel, isDel.NORMAL)))
			.get();
	},

	async latest(c, params, userId) {
		let { emailId, accountId, allReceive, provider } = params;
		allReceive = Number(allReceive);

		const delegatedAuthorization = accountId && !allReceive
			? await this.delegatedMailboxAuthorization(c, userId, accountId)
			: null;
		const mailOwnerUserId = delegatedAuthorization?.owner_user_id || userId;

		if (isNaN(allReceive)) {
			let accountRow = await accountService.selectByIdForUser(c, accountId, userId);
			if (!accountRow && delegatedAuthorization) {
				accountRow = await accountService.selectById(c, accountId);
			}
			allReceive = accountRow?.allReceive || 0;
		}

		const allReceiveScopeCondition = allReceive
			? await this.allReceiveMailboxScopeCondition(c, userId)
			: null;
		const accountScopeCondition = allReceive
			? allReceiveScopeCondition
			: and(eq(email.accountId, accountId), eq(email.userId, mailOwnerUserId));

		const conditions = [
			gt(email.emailId, emailId),
			accountScopeCondition,
			eq(email.isDel, isDel.NORMAL),
			eq(account.userId, email.userId),
			eq(account.isDel, isDel.NORMAL),
			eq(email.type, emailConst.type.RECEIVE)
		];
		if (provider) {
			conditions.push(eq(email.provider, String(provider)));
		}

		let list = await orm(c).select({
			...email,
			accountEmailFromAccount: account.email,
			accountProvider: account.provider,
			accountDomainFromAccount: account.domain
		}).from(email)
			.leftJoin(
				account,
				and(
					eq(account.accountId, email.accountId),
					eq(account.userId, email.userId)
				)
			)
			.where(and(...conditions))
			.orderBy(desc(email.emailId))
			.limit(20);

		list = list.map(item => this.withSourceTruth(item));

		await this.emailAddAtt(c, list);

		return list;
	},

	async physicsDelete(c, params) {
		let { emailIds } = params;
		emailIds = emailIds.split(',').map(Number);
		await attService.removeByEmailIds(c, emailIds);
		await starService.removeByEmailIds(c, emailIds);
		await orm(c).delete(email).where(inArray(email.emailId, emailIds)).run();
	},

	async physicsDeleteUserIds(c, userIds) {
		await attService.removeByUserIds(c, userIds);
		await orm(c).delete(email).where(inArray(email.userId, userIds)).run();
	},

	updateEmailStatus(c, params) {
		const { status, resendEmailId, message } = params;
		return orm(c).update(email).set({
			status: status,
			message: message
		}).where(eq(email.resendEmailId, resendEmailId)).returning().get();
	},

	async selectUserEmailCountList(c, userIds, type, del = isDel.NORMAL) {
		const result = await orm(c)
			.select({
				userId: email.userId,
				count: count(email.emailId)
			})
			.from(email)
			.where(and(
				inArray(email.userId, userIds),
				eq(email.type, type),
				eq(email.isDel, del),
				ne(email.status, emailConst.status.SAVING),
			))
			.groupBy(email.userId);
		return result;
	},

	// FTS-backed condition (WF-7 / WP-C). Keeps candidate matching inside SQL so
	// high-frequency searches cannot create large IN (?, ?, ...) parameter lists.
	async ftsSearchCondition(c, term) {
		const q = buildFtsQuery(term);
		if (!q) return null; // no usable term -> caller should skip FTS filter
		try {
			await c.env.db.prepare(`SELECT rowid FROM email_fts LIMIT 1`).first();
			return sql`EXISTS (
				SELECT 1 FROM email_fts
				WHERE email_fts.rowid = ${email.emailId}
				  AND email_fts MATCH ${q}
			)`;
		} catch (e) {
			// FTS unavailable (e.g. pre-migration) → signal fallback to LIKE.
			console.warn('FTS search unavailable, falling back to LIKE:', String(e?.message || e));
			return null;
		}
	},

	async allList(c, params) {

		let { emailId, size, name, subject, accountEmail, userEmail, type, timeSort, keyword } = params;

		size = Number(size);

		emailId = Number(emailId);
		timeSort = Number(timeSort);

		if (Number.isNaN(size) || size <= 0) {
			size = 30;
		} else if (size > 50) {
			size = 50;
		}

		if (Number.isNaN(emailId) || emailId <= 0) {
			emailId = timeSort ? 0 : 9999999999;
		}

		const conditions = [];

		if (type === 'send') {
			conditions.push(eq(email.type, emailConst.type.SEND));
		}

		if (type === 'receive') {
			conditions.push(eq(email.type, emailConst.type.RECEIVE));
		}

		if (type === 'delete') {
			conditions.push(eq(email.isDel, isDel.DELETE));
		}

		if (type === 'noone') {
			conditions.push(eq(email.status, emailConst.status.NOONE));
		}

		if (userEmail) {
			conditions.push(sql`${user.email} COLLATE NOCASE LIKE ${'%'+ userEmail + '%'}`);
		}

		if (accountEmail) {
			conditions.push(
				or(
					sql`${email.toEmail} COLLATE NOCASE LIKE ${'%'+ accountEmail + '%'}`,
					sql`${email.sendEmail} COLLATE NOCASE LIKE ${'%'+ accountEmail + '%'}`,
				)
			)
		}

		if (name) {
			conditions.push(sql`${email.name} COLLATE NOCASE LIKE ${'%'+ name + '%'}`);
		}

		if (subject) {
			conditions.push(sql`${email.subject} COLLATE NOCASE LIKE ${'%'+ subject + '%'}`);
		}

		// Free-text keyword → FTS index (WF-7). Falls back to LIKE on subject/text
		// if the FTS index is unavailable, preserving behavior on older DBs.
		if (keyword) {
			const ftsCondition = await this.ftsSearchCondition(c, keyword);
			if (ftsCondition) {
				conditions.push(ftsCondition);
			} else {
				conditions.push(
					or(
						sql`${email.subject} COLLATE NOCASE LIKE ${'%'+ keyword + '%'}`,
						sql`${email.text} COLLATE NOCASE LIKE ${'%'+ keyword + '%'}`,
						sql`${email.name} COLLATE NOCASE LIKE ${'%'+ keyword + '%'}`,
					)
				);
			}
		}

		conditions.push(ne(email.status, emailConst.status.SAVING));

		const countConditions = [...conditions];

		if (timeSort) {
			conditions.unshift(gt(email.emailId, emailId));
		} else {
			conditions.unshift(lt(email.emailId, emailId));
		}

		const query = orm(c).select({ ...email, userEmail: user.email })
			.from(email)
			.leftJoin(user, eq(email.userId, user.userId))
			.where(and(...conditions));

		const queryCount = orm(c).select({ total: count() })
			.from(email)
			.leftJoin(user, eq(email.userId, user.userId))
			.where(and(...countConditions));

		if (timeSort) {
			query.orderBy(asc(email.emailId));
		} else {
			query.orderBy(desc(email.emailId));
		}

		const listQuery = await query.limit(size).all();
		const totalQuery = await queryCount.get();
		const latestEmailQuery = await orm(c).select().from(email)
			.where(and(
				eq(email.type, emailConst.type.RECEIVE),
				ne(email.status, emailConst.status.SAVING)
			))
			.orderBy(desc(email.emailId)).limit(1).get();

		let [list, totalRow, latestEmail] = await Promise.all([listQuery, totalQuery, latestEmailQuery]);

		await this.emailAddAtt(c, list);

		if (!latestEmail) {
			latestEmail = {
				emailId: 0,
				accountId: 0,
				userId: 0,
			}
		}

		return { list: list, total: totalRow.total, latestEmail };
	},

	async allEmailLatest(c, params) {

		const { emailId } = params;

		let list = await orm(c).select({...email, userEmail: user.email}).from(email)
			.leftJoin(user, eq(email.userId, user.userId))
			.where(
				and(
					gt(email.emailId, emailId),
					eq(email.type, emailConst.type.RECEIVE),
					ne(email.status, emailConst.status.SAVING)
				))
			.orderBy(desc(email.emailId))
			.limit(20);

		await this.emailAddAtt(c, list);

		return list;
	},

	async emailAddAtt(c, list) {

		const emailIds = list.map(item => item.emailId);

		if (emailIds.length > 0) {

			const { r2Domain } = await settingService.query(c);
			const requestOrigin = c?.req?.url ? new URL(c.req.url).origin : '';
			const attachmentOrigin = r2Domain ? domainUtils.toOssDomain(r2Domain) : requestOrigin;
			const attList = (await attService.selectByEmailIds(c, emailIds)).map(attRow => {
				const downloadURL = attachmentOrigin && attRow.key ? `${attachmentOrigin}/${attRow.key}` : undefined;
				return {
					...attRow,
					id: attRow.attId,
					contentType: attRow.mimeType,
					byteSize: attRow.size,
					downloadURL,
					downloadUrl: downloadURL
				};
			});

			list.forEach(emailRow => {
				const atts = attList.filter(attRow => attRow.emailId === emailRow.emailId);
				emailRow.attList = atts;
			});
		}
	},

	async restoreByUserId(c, userId) {
		await orm(c).update(email).set({ isDel: isDel.NORMAL }).where(eq(email.userId, userId)).run();
	},

	async completeReceive(c, status, emailId) {
		return await orm(c).update(email).set({
			isDel: isDel.NORMAL,
			status: status
		}).where(eq(email.emailId, emailId)).returning().get();
	},

	async completeReceiveAll(c) {
		await c.env.db.prepare(`UPDATE email as e SET status = ${emailConst.status.RECEIVE} WHERE status = ${emailConst.status.SAVING} AND EXISTS (SELECT 1 FROM account WHERE account_id = e.account_id)`).run();
		await c.env.db.prepare(`UPDATE email as e SET status = ${emailConst.status.NOONE} WHERE status = ${emailConst.status.SAVING} AND NOT EXISTS (SELECT 1 FROM account WHERE account_id = e.account_id)`).run();
	},

	async batchDelete(c, params) {
		let { sendName, sendEmail, toEmail, subject, startTime, endTime, type  } = params

		let right = type === 'left' || type === 'include'
		let left = type === 'include'

		const conditions = []

		if (sendName) {
			conditions.push(like(email.name,`${left ? '%' : ''}${sendName}${right ? '%' : ''}`))
		}

		if (subject) {
			conditions.push(like(email.subject,`${left ? '%' : ''}${subject}${right ? '%' : ''}`))
		}

		if (sendEmail) {
			conditions.push(like(email.sendEmail,`${left ? '%' : ''}${sendEmail}${right ? '%' : ''}`))
		}

		if (toEmail) {
			conditions.push(like(email.toEmail,`${left ? '%' : ''}${toEmail}${right ? '%' : ''}`))
		}

		if (startTime && endTime) {
			conditions.push(gte(email.createTime,`${startTime}`))
			conditions.push(lte(email.createTime,`${endTime}`))
		}

		if (conditions.length === 0) {
			return;
		}

		const emailIdsRow = await orm(c).select({emailId: email.emailId}).from(email).where(conditions.length > 1 ? and(...conditions) : conditions[0]).all();

		const emailIds = emailIdsRow.map(row => row.emailId);

		if (emailIds.length === 0){
			return;
		}

		await attService.removeByEmailIds(c, emailIds);
		// D6 / WF-11 fix: also remove star rows so they don't orphan after the
		// emails are physically deleted below.
		await starService.removeByEmailIds(c, emailIds);

		await orm(c).delete(email).where(conditions.length > 1 ? and(...conditions) : conditions[0]).run();
	},

	async physicsDeleteByAccountId(c, accountId) {
		await attService.removeByAccountId(c, accountId);
		await orm(c).delete(email).where(eq(email.accountId, accountId)).run();
	},

	async read(c, params, userId) {
		const { emailIds } = params;
		await orm(c).update(email).set({ unread: emailConst.unread.READ }).where(and(eq(email.userId, userId), inArray(email.emailId, emailIds)));
	}
};

export default emailService;
