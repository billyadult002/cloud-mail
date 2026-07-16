import PostalMime from 'postal-mime';
import emailService from '../service/email-service';
import accountService from '../service/account-service';
import settingService from '../service/setting-service';
import attService from '../service/att-service';
import constant from '../const/constant';
import fileUtils from '../utils/file-utils';
import { emailConst, isDel, settingConst } from '../const/entity-const';
import emailUtils from '../utils/email-utils';
import roleService from '../service/role-service';
import userService from '../service/user-service';
import telegramService from '../service/telegram-service';
import aiService from '../service/ai-service';

const encoder = new TextEncoder();
const DEFAULT_MAX_INBOUND_EMAIL_BYTES = 10 * 1024 * 1024;

function normalizeEmail(value) {
	return String(value || '').trim().toLowerCase();
}

function managedDomains(env) {
	let domains = env.domain;
	if (typeof domains === 'string') {
		try {
			domains = JSON.parse(domains);
		} catch {
			domains = [];
		}
	}
	return Array.isArray(domains) ? domains.map(value => String(value).toLowerCase()) : [];
}

async function sha256(value) {
	const digest = await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value);
	return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function audit(env, action, outcome, metadata = {}) {
	await env.db.prepare(
		`INSERT INTO audit_logs (actor_role, action, resource_type, outcome, metadata_json)
		 VALUES ('system', ?1, 'mail', ?2, ?3)`
	).bind(action, outcome, JSON.stringify(metadata)).run();
}

export async function email(message, env, ctx) {

	try {

		const {
			receive,
			tgChatId,
			tgBotStatus,
			forwardStatus,
			forwardEmail,
			ruleEmail,
			ruleType,
			r2Domain,
			noRecipient,
			blackSubject,
			blackContent,
			blackFrom,
			aiCode,
			aiCodeFilter
		} = await settingService.query({ env });

		if (receive === settingConst.receive.CLOSE) {
			message.setReject('Service suspended');
			return;
		}

		const reader = message.raw.getReader();
		let content = '';
		let receivedBytes = 0;
		const maxInboundBytes = Number(env.MAX_INBOUND_EMAIL_BYTES || DEFAULT_MAX_INBOUND_EMAIL_BYTES);

		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			receivedBytes += value?.byteLength || 0;
			if (receivedBytes > maxInboundBytes) {
				message.setReject('Message too large');
				await audit(env, 'mail_received', 'rejected_too_large', {
					recipient: normalizeEmail(message.to),
					maxInboundBytes
				});
				return;
			}
			content += new TextDecoder().decode(value);
		}

		const email = await PostalMime.parse(content);
		const normalizedRecipient = normalizeEmail(message.to);
		const contentHash = await sha256(content);
		const messageId = normalizeEmail(email.messageId || message.headers.get('message-id') || '');
		const messageKey = messageId || `content:${contentHash}`;
		await audit(env, 'mail_received', 'accepted_for_processing', {
			recipient: normalizedRecipient,
			messageId,
			contentHash
		});


		const blockFlag = checkBlock(blackSubject, blackContent, blackFrom, email);

		if (blockFlag) {
			message.setReject('Message rejected');
			return;
		}

		const account = await accountService.selectByEmailIncludeDel({ env: env }, message.to);
		let routingIdentity = account ? null : await env.db.prepare(
			`SELECT id, status FROM email_identities
			  WHERE normalized_email = ?1
			    AND routing_enabled = 1
			    AND status IN ('routing_only', 'pending', 'catch_all_eligible', 'active')
			  LIMIT 1`
		).bind(normalizedRecipient).first();
		const recipientDomain = normalizedRecipient.split('@')[1] || '';
		const catchAllEnabled = String(env.CLOUDFLARE_CATCH_ALL_ENABLED || '').toLowerCase() === 'true';
		if (!account && !routingIdentity && catchAllEnabled && managedDomains(env).includes(recipientDomain)) {
			await env.db.prepare(
				`INSERT INTO email_identities
				 (email, normalized_email, domain, source, routing_rule_id, routing_enabled,
				  forwarding_preserved, status, last_synced_at)
				 VALUES (?1, ?1, ?2, 'cloudflare_routing', ?3, 1, 0, 'catch_all_eligible', CURRENT_TIMESTAMP)
				 ON CONFLICT(normalized_email) DO UPDATE SET
				   routing_enabled = 1,
				   status = CASE WHEN email_identities.status = 'active'
				                 THEN 'active' ELSE 'catch_all_eligible' END,
				   last_synced_at = CURRENT_TIMESTAMP,
				   updated_at = CURRENT_TIMESTAMP`
			).bind(normalizedRecipient, recipientDomain, env.CLOUDFLARE_CATCH_ALL_RULE_ID || null).run();
			routingIdentity = await env.db.prepare(
				`SELECT id, status FROM email_identities WHERE normalized_email = ?1 LIMIT 1`
			).bind(normalizedRecipient).first();
		}

		if (!account && !routingIdentity && noRecipient === settingConst.noRecipient.CLOSE) {
			message.setReject('Recipient not found');
			return;
		}

		let userRow = {}

		if (account) {
			 userRow = await userService.selectByIdIncludeDel({ env: env }, account.userId);
		}

		const fromAddress = email.from?.address || message.from || '';
		const fromName = email.from?.name || emailUtils.getName(fromAddress);

		if (account && userRow.email !== env.admin) {

			let { banEmail, availDomain } = await roleService.selectByUserId({ env: env }, account.userId);

			if (!roleService.hasAvailDomainPerm(availDomain, message.to)) {
				message.setReject('The recipient is not authorized to use this domain.');
				return;
			}

			if(roleService.isBanEmail(banEmail, fromAddress)) {
				message.setReject('The recipient is disabled from receiving emails.');
				return;
			}

		}

		const priorDelivery = await env.db.prepare(
			`SELECT id, forwarded, stored FROM mail_delivery_dedupe
			  WHERE message_key = ?1 AND normalized_recipient = ?2 AND content_hash = ?3
			  LIMIT 1`
		).bind(messageKey, normalizedRecipient, contentHash).first();
		if (priorDelivery && (priorDelivery.stored || priorDelivery.forwarded)) {
			await audit(env, 'duplicate_suppressed', 'suppressed', {
				recipient: normalizedRecipient,
				messageId,
				contentHash
			});
			return;
		}
		let dedupeId = priorDelivery?.id;
		if (!dedupeId) {
			const dedupeResult = await env.db.prepare(
				`INSERT INTO mail_delivery_dedupe
				 (message_id, message_key, recipient, normalized_recipient, content_hash, forwarded, stored)
				 VALUES (?1, ?2, ?3, ?3, ?4, 0, 0)`
			).bind(messageId || null, messageKey, normalizedRecipient, contentHash).run();
			dedupeId = dedupeResult.meta?.last_row_id;
		}

		if (!email.to) {
			email.to = [{ address: message.to, name: emailUtils.getName(message.to)}]
		}

		const toName = email.to.find(item => item.address === message.to)?.name || '';
		const code = await aiService.extractCode({ env }, email, { aiCode, aiCodeFilter });

		const params = {
			toEmail: message.to,
			toName: toName,
			sendEmail: fromAddress,
			name: fromName,
			subject: email.subject,
			code,
			content: email.html,
			text: email.text,
			cc: email.cc ? JSON.stringify(email.cc) : '[]',
			bcc: email.bcc ? JSON.stringify(email.bcc) : '[]',
			recipient: JSON.stringify(email.to),
			inReplyTo: email.inReplyTo,
			relation: email.references,
			messageId: email.messageId,
			provider: account?.provider || 'cloudflare_native',
			accountEmail: account?.email || message.to,
			accountDomain: account?.domain || recipientDomain,
			threadId: email.inReplyTo || email.references || email.messageId || '',
			externalMessageId: email.messageId || '',
			userId: account ? account.userId : 0,
			accountId: account ? account.accountId : 0,
			isDel: isDel.DELETE,
			status: emailConst.status.SAVING
		};

		const attachments = [];
		const cidAttachments = [];

		for (let item of email.attachments) {
			let attachment = { ...item };
			attachment.key = constant.ATTACHMENT_PREFIX + await fileUtils.getBuffHash(attachment.content) + fileUtils.getExtFileName(item.filename);
			attachment.size = item.content.length ?? item.content.byteLength;
			attachments.push(attachment);
			if (attachment.contentId) {
				cidAttachments.push(attachment);
			}
		}

		let emailRow = await emailService.receive({ env }, params, cidAttachments, r2Domain);

		attachments.forEach(attachment => {
			attachment.emailId = emailRow.emailId;
			attachment.userId = emailRow.userId;
			attachment.accountId = emailRow.accountId;
		});

		// WF-5 / WP-B: attachment-safe receive. Previously an addAtt failure was
		// swallowed and the message was still finalized (status RECEIVE, dedupe
		// stored=1), permanently losing the attachments AND suppressing the
		// provider retry that could have recovered them. Now: if attachments fail
		// to persist, roll back the still-hidden email row (status SAVING /
		// isDel=DELETE) and rethrow WITHOUT marking dedupe stored, so the provider
		// re-delivers and the message is reprocessed cleanly (no duplicate row).
		if (attachments.length > 0) {
			try {
				await attService.addAtt({ env }, attachments);
			} catch (e) {
				console.error('邮件附件持久化失败，回滚邮件以便重试: ', e);
				try {
					await emailService.physicsDelete({ env }, { emailIds: String(emailRow.emailId) });
				} catch (rollbackErr) {
					console.error('回滚邮件行失败: ', rollbackErr);
				}
				await audit(env, 'mail_store_failed', 'attachment_persist_failed', {
					recipient: normalizedRecipient,
					messageId,
					contentHash
				});
				throw e; // propagate → provider retry; dedupe NOT finalized
			}
		}

			emailRow = await emailService.completeReceive({ env }, account ? emailConst.status.RECEIVE : emailConst.status.NOONE, emailRow.emailId);
			// Only NOW is the message durably stored with its attachments — safe
			// to finalize the dedupe record and suppress future retries.
			if (dedupeId) {
				await env.db.prepare(
					`UPDATE mail_delivery_dedupe SET stored = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?1`
				).bind(dedupeId).run();
			}
			await audit(env, 'mail_stored', routingIdentity && !account ? 'pending_identity' : 'success', {
				recipient: normalizedRecipient,
				emailId: emailRow.emailId,
				messageId,
				identityId: routingIdentity?.id || null
			});


		if (ruleType === settingConst.ruleType.RULE) {

			const emails = ruleEmail.split(',');

			if (!emails.includes(message.to)) {
				return;
			}

		}

		//转发到TG
		if (tgBotStatus === settingConst.tgBotStatus.OPEN && tgChatId) {
			await telegramService.sendEmailToBot({ env }, emailRow)
		}

			const forwardingTargets = new Set();
			if (forwardStatus === settingConst.forwardStatus.OPEN && forwardEmail) {
				for (const target of forwardEmail.split(',').map(normalizeEmail).filter(Boolean)) {
					forwardingTargets.add(target);
				}
			}
			const preserved = await env.db.prepare(
				`SELECT destination_email FROM email_forwarding_destinations
				  WHERE normalized_source_email = ?1 AND forwarding_enabled = 1
				    AND preserve_original_forwarding = 1`
			).bind(normalizedRecipient).all();
			for (const row of preserved.results || []) {
				const target = normalizeEmail(row.destination_email);
				if (target) forwardingTargets.add(target);
			}

			let forwardedCount = 0;
			for (const target of forwardingTargets) {
				try {
					await message.forward(target);
					forwardedCount += 1;
					await env.db.prepare(
						`UPDATE email_forwarding_destinations
						    SET last_forwarded_at = CURRENT_TIMESTAMP, last_error = NULL, updated_at = CURRENT_TIMESTAMP
						  WHERE normalized_source_email = ?1 AND destination_email = ?2`
					).bind(normalizedRecipient, target).run();
					await audit(env, 'mail_forwarded', 'success', { recipient: normalizedRecipient, targetDomain: target.split('@')[1] || '', messageId });
				} catch (e) {
					console.error(`转发邮箱 ${target} 失败：`, e);
					await env.db.prepare(
						`UPDATE email_forwarding_destinations
						    SET last_error = ?3, updated_at = CURRENT_TIMESTAMP
						  WHERE normalized_source_email = ?1 AND destination_email = ?2`
					).bind(normalizedRecipient, target, String(e?.message || e).slice(0, 300)).run();
					await audit(env, 'mail_forward_failed', 'failed', { recipient: normalizedRecipient, targetDomain: target.split('@')[1] || '', messageId });
				}
			}
			if (dedupeId && forwardedCount > 0) {
				await env.db.prepare(
					`UPDATE mail_delivery_dedupe SET forwarded = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?1`
				).bind(dedupeId).run();
			}

		} catch (e) {
			console.error('邮件接收异常: ', e);
		throw e
	}
}

function checkBlock(blackSubjectStr, blackContentStr, blackFromStr, email) {

	const blackFromList = blackFromStr ? blackFromStr.split(',') : []
	const blackContentList = blackContentStr ? blackContentStr.split(',') : []
	const blackSubjectList = blackSubjectStr ? blackSubjectStr.split(',') : []

	for (const blackSubject of blackSubjectList) {
		if (email.subject?.includes(blackSubject)) {
			return true
		}
	}

	for (const blackContent of blackContentList) {
		if (email.html?.includes(blackContent) || email.text?.includes(blackContent)) {
			return true
		}
	}

	const fromAddress = email.from?.address || '';
	for (const blackFrom of blackFromList) {
		if (fromAddress === blackFrom || emailUtils.getDomain(fromAddress) === blackFrom) {
			return true
		}
	}

	return false

}
