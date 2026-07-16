import emailService from './email-service';
import { emailConst } from '../const/entity-const';
import BizError from '../error/biz-error';

const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

function base64Bytes(value) {
	const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
	return Uint8Array.from(atob(padded), char => char.charCodeAt(0));
}

async function verifySignature(c, rawBody) {
	const secret = String(c.env.RESEND_WEBHOOK_SECRET || '').trim();
	if (!secret) throw new BizError('Webhook verification is not configured.', 503);
	const webhookId = c.req.header('svix-id');
	const timestamp = c.req.header('svix-timestamp');
	const signatures = c.req.header('svix-signature') || '';
	const timestampSeconds = Number(timestamp);
	if (!webhookId || !timestamp || !Number.isFinite(timestampSeconds) || Math.abs(Math.floor(Date.now() / 1000) - timestampSeconds) > WEBHOOK_TOLERANCE_SECONDS) {
		throw new BizError('Invalid webhook timestamp.', 400);
	}
	const encodedSecret = secret.startsWith('whsec_') ? secret.slice(6) : secret;
	const key = await crypto.subtle.importKey('raw', base64Bytes(encodedSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
	const signedContent = `${webhookId}.${timestamp}.${rawBody}`;
	const valid = await Promise.any(
		signatures.split(' ').filter(Boolean).map(value => {
			const [version, encoded] = value.split(',', 2);
			if (version !== 'v1' || !encoded) return Promise.resolve(false);
			return crypto.subtle.verify('HMAC', key, base64Bytes(encoded), new TextEncoder().encode(signedContent));
		})
	).catch(() => false);
	if (!valid) throw new BizError('Invalid webhook signature.', 400);
}

const resendService = {

	async webhooks(c, body, rawBody = JSON.stringify(body)) {
		await verifySignature(c, rawBody);
		const eventId = c.req.header('svix-id') || body?.data?.email_id;
		if (!eventId) throw new BizError('Webhook event id is missing.', 400);
		const dedupeKey = `cloudmail:resend-webhook:${eventId}`;
		if (await c.env.kv.get(dedupeKey)) return { duplicate: true };

		const params = {
			resendEmailId: body.data.email_id,
			status: emailConst.status.SENT
		}

		if (body.type === 'email.delivered') {
			params.status = emailConst.status.DELIVERED
			params.message = null
		}

		if (body.type === 'email.complained') {
			params.status = emailConst.status.COMPLAINED
			params.message = null
		}

		if (body.type === 'email.bounced') {
			let bounce = body.data.bounce
			bounce = JSON.stringify(bounce);
			params.status = emailConst.status.BOUNCED
			params.message = bounce
		}

		if (body.type === 'email.delivery_delayed') {
			params.status = emailConst.status.DELAYED
			params.message = null
		}

		if (body.type === 'email.failed') {
			params.status = emailConst.status.FAILED
			params.message = body.data.failed.reason
		}

		if (!params.resendEmailId) throw new BizError('Webhook email id is missing.', 400);
		const emailRow = await emailService.updateEmailStatus(c, params)

		if (!emailRow) {
			throw new BizError('更新邮件状态记录失败');
		}
		await c.env.kv.put(dedupeKey, '1', { expirationTtl: 60 * 60 * 24 * 7 });
		return { duplicate: false };

	}
}

export default resendService
