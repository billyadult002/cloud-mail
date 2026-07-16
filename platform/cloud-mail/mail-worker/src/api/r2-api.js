import r2Service from '../service/r2-service';
import app from '../hono/hono';
import geminiOAuthService from '../service/gemini-oauth-service';

app.get('/oss/*', async (c) => {
	const key = c.req.path.split('/oss/')[1];
	const requester = c.get('user');
	if (!requester?.userId) return new Response('Unauthorized', { status: 401, headers: { 'Cache-Control': 'no-store' } });
	if (key.startsWith('gmail-att:')) {
		try {
			const parts = key.split(':');
			const accountId = Number(parts[1]);
			const messageId = parts[2];
			const attachmentId = parts[3];

			const account = await c.env.db.prepare(
				`SELECT user_id FROM account WHERE account_id = ?1 LIMIT 1`
			).bind(accountId).first();
			if (!account) return new Response('Account not found', { status: 404 });
			if (Number(account.user_id) !== Number(requester.userId)) {
				return new Response('Forbidden', { status: 403, headers: { 'Cache-Control': 'no-store' } });
			}

			const accessToken = await geminiOAuthService.getValidMailboxAccessToken(c, account.user_id, accountId);

			const response = await fetch(
				`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(messageId)}/attachments/${encodeURIComponent(attachmentId)}`,
				{
					headers: {
						Authorization: `Bearer ${accessToken}`
					}
				}
			);
			if (!response.ok) return new Response('Attachment fetch failed', { status: response.status });
			const body = await response.json();

			const base64 = (body.data || '').replace(/-/g, '+').replace(/_/g, '/');
			const binaryString = atob(base64);
			const len = binaryString.length;
			const bytes = new Uint8Array(len);
			for (let i = 0; i < len; i++) {
				bytes[i] = binaryString.charCodeAt(i);
			}

			return new Response(bytes, {
				headers: {
					'Content-Type': 'application/octet-stream',
					'Cache-Control': 'private, no-store',
					'X-Content-Type-Options': 'nosniff'
				}
			});
		} catch (e) {
			return new Response(e.message, { status: 500 });
		}
	}

	const ownedAttachment = await c.env.db.prepare(
		`SELECT 1 FROM attachments WHERE key = ?1 AND user_id = ?2 LIMIT 1`
	).bind(key, requester.userId).first();
	if (!ownedAttachment) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });

	const obj = await r2Service.getObj(c, key);
	if (!obj) return new Response('Not found', { status: 404, headers: { 'Cache-Control': 'no-store' } });
	return new Response(obj.body, {
		headers: {
			'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream',
			'Content-Disposition': obj.httpMetadata?.contentDisposition || 'attachment',
			'Cache-Control': 'private, no-store',
			'X-Content-Type-Options': 'nosniff'
		}
	});
});
