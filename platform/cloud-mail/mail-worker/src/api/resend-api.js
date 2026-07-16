import resendService from '../service/resend-service';
import app from '../hono/hono';
app.post('/webhooks',async (c) => {
	try {
		const rawBody = await c.req.text();
		const body = JSON.parse(rawBody);
		await resendService.webhooks(c, body, rawBody);
		return c.text('success', 200)
	} catch (e) {
		const status = Number(e?.code || e?.status) || 400;
		return c.text(status >= 500 ? 'Webhook unavailable' : 'Invalid webhook', status)
	}
})
