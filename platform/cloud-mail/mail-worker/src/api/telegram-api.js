import app from '../hono/hono';
import telegramService from '../service/telegram-service';

app.get('/telegram/getEmail/:token', async (c) => {
	const content = await telegramService.getEmailContent(c, c.req.param());
	c.header('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
	c.header('Pragma', 'no-cache');
	c.header('Expires', '0');
	return c.html(content)
});

