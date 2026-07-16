import BizError from '../error/biz-error';
import KvConst from '../const/kv-const';
import userService from './user-service';
import settingService from './setting-service';

function domainOf(email) {
	return email.split('@')[1] || '';
}

async function sendPasswordResetEmail(c, email, token) {
	const domain = domainOf(email);
	let resendToken = c.env.IDENTITY_RESEND_TOKEN;
	let from = c.env.IDENTITY_FROM_EMAIL;
	if (!resendToken) {
		const settings = await settingService.query(c);
		resendToken = settings.resendTokens?.[domain];
		from ||= `CloudMail <no-reply@${domain}>`;
	}
	if (!resendToken || !from) return false;

	const origin = new URL(c.req.url).origin;
	const resetLink = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			authorization: `Bearer ${resendToken}`,
			'content-type': 'application/json'
		},
		body: JSON.stringify({
			from,
			to: [email],
			subject: 'Reset your CloudMail password',
			html: `<p>Use this secure link to reset your CloudMail password:</p><p><a href="${resetLink}">Reset CloudMail password</a></p><p>This link expires in 30 minutes.</p>`
		})
	});
	return response.ok;
}

const passwordResetService = {
	async forgot(c, params) {
		const email = params.email?.trim().toLowerCase();
		if (!email) {
			throw new BizError('Email is required', 400);
		}

		const user = await userService.selectByEmailIncludeDel(c, email);
		if (!user || user.isDel === 1) {
			return {
				mockMode: false,
				message: 'If the account exists, a password reset link has been sent.'
			};
		}

		const token = crypto.randomUUID().replaceAll('-', '');
		await c.env.kv.put(
			KvConst.PASSWORD_RESET + token,
			JSON.stringify({ userId: user.userId, email: user.email }),
			{ expirationTtl: 1800 }
		);

		const origin = new URL(c.req.url).origin;
		const resetLink = `${origin}/reset-password?token=${encodeURIComponent(token)}`;
		const delivered = await sendPasswordResetEmail(c, email, token);
		if (!delivered) {
			await c.env.kv.delete(KvConst.PASSWORD_RESET + token);
			throw new BizError('Password reset email delivery is unavailable', 503);
		}
		if (String(c.env.IDENTITY_E2E_MODE).toLowerCase() === 'true') {
			return {
				mockMode: true,
				resetToken: token,
				resetLink,
				message: 'Password reset link sent.'
			};
		}
		return {
			mockMode: false,
			message: 'If the account exists, a password reset link has been sent.'
		};
	},

	async reset(c, params) {
		const token = params.token?.trim();
		const newPassword = params.newPassword;
		if (!token || !newPassword) {
			throw new BizError('Token and new password are required', 400);
		}

		const record = await c.env.kv.get(KvConst.PASSWORD_RESET + token, { type: 'json' });
		if (!record?.userId) {
			throw new BizError('Invalid or expired reset token', 400);
		}

		await userService.resetPassword(c, { password: newPassword }, record.userId);
		await Promise.all([
			c.env.kv.delete(KvConst.PASSWORD_RESET + token),
			c.env.kv.delete(KvConst.AUTH_INFO + record.userId)
		]);
		return { message: 'Password updated' };
	}
};

export default passwordResetService;
