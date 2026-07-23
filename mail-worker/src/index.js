import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import kvObjService from './service/kv-obj-service';
import oauthService from "./service/oauth-service";
import scheduledCapabilityRuntime from './service/scheduled-capability-runtime-service.js';
import connectionRuntime from './service/connection-runtime-service.js';
import refreshScheduler from './service/nexora-onboarding-refresh-scheduler-service.js';
export default {
	 async fetch(req, env, ctx) {

		const url = new URL(req.url)

		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '')
			req = new Request(url.toString(), req)
			return app.fetch(req, env, ctx);
		}

		if (url.pathname.startsWith('/v3/')) {
			return app.fetch(req, env, ctx);
		}

		 if (['/static/','/attachments/'].some(p => url.pathname.startsWith(p))) {
			 return await kvObjService.toObjResp( { env }, url.pathname.substring(1));
		 }

		return env.assets.fetch(req);
	},
	email: email,
	async scheduled(c, env, ctx) {
		await verifyRecordService.clearRecord({ env })
		await userService.resetDaySendCount({ env })
		await emailService.completeReceiveAll({ env })
		await oauthService.clearNoBindOathUser({ env })
		await scheduledCapabilityRuntime.monitorScheduled({ env })
		await connectionRuntime.monitorScheduled({ env })
		if (String(env.NEXORA_CONNECTION_REFRESH_ENABLED || 'false').toLowerCase() === 'true' && String(env.NEXORA_CONNECTION_RUNTIME_ENABLED || 'false').toLowerCase() === 'true' && String(env.NEXORA_CONNECTION_RUNTIME_EMERGENCY_DISABLED || 'true').toLowerCase() === 'false') {
			const one = (value) => { const items=String(value||'').split(',').map((v)=>v.trim()).filter(Boolean); return items.length===1 ? items[0] : null; };
			const selection={ tenant_id:Number(one(env.NEXORA_CONNECTION_TENANT_ALLOWLIST)),workspace_id:Number(one(env.NEXORA_CONNECTION_WORKSPACE_ALLOWLIST)),actor_user_id:Number(one(env.NEXORA_CONNECTION_TENANT_ALLOWLIST)),account_id:Number(one(env.NEXORA_CONNECTION_ACCOUNT_ALLOWLIST)),provider:one(env.NEXORA_CONNECTION_PROVIDER_ALLOWLIST) };
			if (!Number.isInteger(selection.tenant_id)||!Number.isInteger(selection.workspace_id)||!Number.isInteger(selection.account_id)||selection.provider!=='google') throw new Error('connection_refresh_rollout_scope_invalid');
			await refreshScheduler.runScheduledRefresh({ env }, { limit: 1, selection });
		}
	},
};
