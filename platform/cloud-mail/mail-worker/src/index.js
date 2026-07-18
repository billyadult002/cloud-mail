import app from './hono/webs';
import { email } from './email/email';
import userService from './service/user-service';
import verifyRecordService from './service/verify-record-service';
import emailService from './service/email-service';
import kvObjService from './service/kv-obj-service';
import r2Service from './service/r2-service';
import oauthService from "./service/oauth-service";
import analysisService from './service/analysis-service';
import cloudMailV2Service from './service/cloudmail-v2-service';
import gmailImapService from './service/gmail-imap-service';
import outboundService from './service/outbound-service';
import runtimeTelemetryService from './service/runtime-telemetry-service';
import nexoraV3Service from './service/nexora-v3-service';
import durableMissionRuntimeService from './service/durable-mission-runtime-service';
import classificationIntelligenceService from './service/classification-intelligence-service';
import unifiedConversationBackfillService from './service/unified-conversation-backfill-service';
import onboardingRefreshScheduler from './service/nexora-onboarding-refresh-scheduler-service';
import onboardingSync from './service/nexora-onboarding-sync-service';

async function runAutomaticGmailSync(env, scheduled) {
	try {
		return await gmailImapService.autoSync({ env }, {
			cron: scheduled?.cron
		});
	} catch (error) {
		console.error('Automatic Gmail sync failed:', String(error?.message || error).slice(0, 300));
		return { checked: 0, syncedAccounts: 0, failedAccounts: 1, errors: 1 };
	}
}

// Content-Security-Policy (P0-1 / WF-1, Phase B). Shipped in Report-Only mode
// first so we can observe violations and legitimate breakages before enforcing.
// 'unsafe-inline' for style is retained initially because the SPA and email
// bodies rely on inline styles; script stays locked down (no 'unsafe-inline').
const CSP_REPORT_ONLY_POLICY = [
	"default-src 'self'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self' https: data:",
	"font-src 'self' https: data:",
	"connect-src 'self' https:",
	"frame-src 'none'",
	"object-src 'none'",
	"base-uri 'self'",
	"form-action 'self'",
	"frame-ancestors 'none'",
	"report-uri /api/csp-report",
	"report-to csp-endpoint"
].join('; ');

function applyCspReportOnly(response) {
	// Only annotate HTML documents; assets (js/css/img) don't need the header.
	const contentType = response.headers.get('content-type') || '';
	if (!contentType.includes('text/html')) return response;
	const headers = new Headers(response.headers);
	headers.set('content-security-policy-report-only', CSP_REPORT_ONLY_POLICY);
	headers.set('reporting-endpoints', 'csp-endpoint="/api/csp-report"');
	headers.set('x-content-type-options', 'nosniff');
	if (!headers.has('x-frame-options')) headers.set('x-frame-options', 'DENY');
	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

async function handleCspReport(req) {
	try {
		const body = await req.text();
		// Keep it lightweight: log a bounded summary; a real deployment would
		// forward to an analytics sink. Never store PII from the report.
		console.warn('[csp-report]', body.slice(0, 1000));
	} catch (e) {
		console.warn('[csp-report] unreadable report');
	}
	return new Response(null, { status: 204, headers: { 'cache-control': 'no-store' } });
}

function publicInfoPage({ title, description, sections = [] }) {
	const sectionHtml = sections.map(section => `
<section>
<h2>${section.title}</h2>
${section.body.map(paragraph => `<p>${paragraph}</p>`).join('\n')}
</section>`).join('\n');
	return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;margin:0;color:#172033;background:#f7f8fb;line-height:1.55}
main{max-width:880px;margin:0 auto;padding:40px 20px 56px}
header{padding-bottom:20px;border-bottom:1px solid #d9deea}
h1{font-size:32px;line-height:1.15;margin:0 0 10px}
h2{font-size:20px;margin:28px 0 8px}
p{margin:0 0 12px}
a{color:#1457d9}
.nav{margin-top:16px;display:flex;gap:16px;flex-wrap:wrap}
.updated{color:#5a6475;font-size:14px}
</style></head><body><main>
<header><h1>${title}</h1><p>${description}</p>
<p class="updated">Last updated: July 2, 2026</p>
<nav class="nav"><a href="/google-oauth-verification">OAuth verification</a><a href="/privacy">Privacy Policy</a><a href="/terms">Terms</a></nav>
</header>
${sectionHtml}
</main></body></html>`, {
		headers: {
			'content-type': 'text/html; charset=utf-8',
			'cache-control': 'public, max-age=300',
			'x-content-type-options': 'nosniff'
		}
	});
}

function googleOAuthVerificationPage() {
	return publicInfoPage({
		title: 'CloudMail OAuth Verification',
		description: 'CloudMail connects user-owned Gmail and Google Workspace mailboxes to a private mail client, mailbox sync, search, and optional AI briefing features.',
		sections: [
			{
				title: 'Application Purpose',
				body: [
					'CloudMail lets a signed-in CloudMail user connect their own Google mailbox, sync mail into their CloudMail account, read and search messages, and use mailbox-scoped AI briefing features.',
					'CloudMail does not provide cross-account mailbox access. A Google mailbox token is associated with the signed-in CloudMail user and the Google account identity returned by Google.'
				]
			},
			{
				title: 'Google Data Use',
				body: [
					'CloudMail uses Google OAuth to identify the Google account and request Gmail access required to sync mailbox messages selected by the user.',
					'Gmail message metadata and content are used only to provide mailbox display, synchronization, search, mailbox health, and user-requested briefing features inside CloudMail.'
				]
			},
			{
				title: 'Security And Ownership',
				body: [
					'OAuth tokens are encrypted at rest. Mailbox data remains scoped to the CloudMail user who connected the Google account.',
					'CloudMail does not sell Google user data, does not use Gmail data for advertising, and does not share a platform API key for user-owned Google mailbox access.'
				]
			},
			{
				title: 'Reviewer Links',
				body: [
					'Privacy Policy: <a href="/privacy">https://cloud-mail.fastonegroup.workers.dev/privacy</a>',
					'Terms: <a href="/terms">https://cloud-mail.fastonegroup.workers.dev/terms</a>'
				]
			}
		]
	});
}

function privacyPage() {
	return publicInfoPage({
		title: 'CloudMail Privacy Policy',
		description: 'This policy explains how CloudMail handles account, mailbox, Gmail, Google Workspace, and AI-related data.',
		sections: [
			{
				title: 'Data Collected',
				body: [
					'CloudMail collects account identity, authentication session information, connected mailbox account identifiers, OAuth token references, mailbox metadata, message content, attachments when present, synchronization telemetry, and user settings needed to provide the mail client.',
					'For Google mailboxes, CloudMail stores the Google account email and immutable Google subject identifier returned by Google OAuth.'
				]
			},
			{
				title: 'How Data Is Used',
				body: [
					'Mailbox data is used to display inboxes, message detail, search results, mailbox health, synchronization status, and user-requested AI briefing or drafting features.',
					'CloudMail does not sell Gmail data, use Gmail data for advertising, or allow one CloudMail user to access another user\'s mailbox data.'
				]
			},
			{
				title: 'Storage And Retention',
				body: [
					'OAuth credentials are encrypted before storage. Mailbox data is retained while the user keeps the mailbox connected or the CloudMail account active.',
					'When a user disconnects a provider or requests deletion, CloudMail removes or disables provider token material and removes user-owned mailbox data according to operational retention requirements.'
				]
			},
			{
				title: 'AI Processing',
				body: [
					'AI features are mailbox-scoped and user initiated. CloudMail does not send mailbox data to AI providers unless the user has enabled the relevant AI feature and authorization path.',
					'AI boundaries are designed to prevent cross-account access and to avoid sending contacts, calendar data, or unrelated customer data.'
				]
			},
			{
				title: 'Contact',
				body: [
					'For privacy questions or deletion requests, contact the CloudMail support owner for the Fast One Group CloudMail deployment.'
				]
			}
		]
	});
}

function termsPage() {
	return publicInfoPage({
		title: 'CloudMail Terms',
		description: 'These terms describe acceptable use for CloudMail mailbox and Google OAuth features.',
		sections: [
			{
				title: 'Use Of The Service',
				body: [
					'Users may connect only mailboxes they own or are authorized to manage. Users are responsible for complying with mailbox provider rules and applicable law.',
					'CloudMail provides mailbox access, synchronization, search, and optional AI assistance for the connected user account.'
				]
			},
			{
				title: 'Google Account Authorization',
				body: [
					'Google OAuth authorization is user controlled. Users can remove CloudMail access through CloudMail where supported or through their Google Account security settings.',
					'CloudMail uses OAuth access only to provide the mailbox features represented in the product and privacy policy.'
				]
			},
			{
				title: 'Security',
				body: [
					'Users must keep their CloudMail credentials secure and report unauthorized access promptly.',
					'CloudMail may suspend access to protect users, mailbox data, infrastructure, or provider compliance.'
				]
			}
		]
	});
}

export default {
	 async fetch(req, env, ctx) {

		const url = new URL(req.url)

		// CSP violation reports (Report-Only phase) — handle before API rewrite.
		if (url.pathname === '/api/csp-report' && req.method === 'POST') {
			return await handleCspReport(req);
		}

		if (url.pathname.startsWith('/api/')) {
			url.pathname = url.pathname.replace('/api', '')
			req = new Request(url.toString(), req)
			try {
				return await app.fetch(req, env, ctx);
			} catch (error) {
				return Response.json({
					code: Number(error?.code || error?.status || 500),
					message: String(error?.message || error || 'CloudMail API request failed.').slice(0, 300)
				}, {
					headers: {
						'cache-control': 'no-store',
						'x-content-type-options': 'nosniff'
					}
				});
			}
		}

		if (url.pathname === '/reset-password' || url.pathname === '/activate') {
			const token = url.searchParams.get('token') || '';
			const action = url.pathname === '/activate' ? 'activate' : 'reset-password';
			const title = action === 'activate' ? 'Activate CloudMail' : 'Reset CloudMail Password';
			const target = `glassmail://${action}?token=${encodeURIComponent(token)}`;
			return new Response(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="apple-itunes-app" content="app-argument=${target}">
<title>${title}</title><script>if(${JSON.stringify(Boolean(token))})location.href=${JSON.stringify(target)};</script>
</head><body><main><img src="/branding/cloudmail-logo.png" alt="CloudMail" width="96" height="96">
<h1>${title}</h1><p><a href="${target}">Open CloudMail</a></p></main></body></html>`, {
				headers: {
					'content-type': 'text/html; charset=utf-8',
					'cache-control': 'no-store',
					'x-content-type-options': 'nosniff'
				}
			});
		}

		if (url.pathname === '/google-oauth-verification') return applyCspReportOnly(googleOAuthVerificationPage());
		if (url.pathname === '/privacy') return applyCspReportOnly(privacyPage());
		if (url.pathname === '/terms') return applyCspReportOnly(termsPage());

		 if (url.pathname.startsWith('/static/')) {
			 return await kvObjService.toObjResp( { env }, url.pathname.substring(1));
		 }

		 if (url.pathname.startsWith('/attachments/')) {
			// Attachment objects are user data. Route them through the authenticated
			// API middleware instead of exposing a public object path.
			url.pathname = `/oss/${url.pathname.substring('/attachments/'.length)}`;
			req = new Request(url.toString(), req);
			return await app.fetch(req, env, ctx);
		 }

		// SPA shell + assets: annotate the HTML document with CSP Report-Only.
		return applyCspReportOnly(await env.assets.fetch(req));
	},
	email: email,
	async scheduled(c, env, ctx) {
		// WF-9 / WP-E: run independent maintenance steps concurrently with
		// per-step isolation so one slow/failing step no longer delays or aborts
		// the rest of the chain. Each step is wrapped so a rejection is logged,
		// not thrown, keeping the cron resilient.
		const runStep = async (name, fn) => runtimeTelemetryService.wrapStep({ env }, name, fn, { invocationType: 'scheduled' });

			if (c.cron === '* * * * *' || c.cron === '*/5 * * * *' || c.cron === '*/30 * * * *') {
			// On the Free plan each scheduled invocation has a 10 ms CPU ceiling.
			// Give one lease-fenced UCS item the budget first; its persisted phases
			// make subsequent invocations safe to resume before general maintenance.
			await runStep('unifiedConversation', () => unifiedConversationBackfillService.monitorScheduled({ env }, { limit: 2, membershipLimit: 25 }));
			await Promise.allSettled([
				runStep('gmailSync', () => runAutomaticGmailSync(env, c)),
				runStep('outboundDrain', () => outboundService.drain({ env }, (cc, payload, uid) => emailService.send(cc, payload, uid))),
				runStep('echartsCache', () => analysisService.refreshEchartsCache({ env })),
				runStep('nexoraAutonomy', () => nexoraV3Service.monitorScheduled({ env }, { limit: 10 })),
				runStep('durableMissionRuntime', () => durableMissionRuntimeService.monitorScheduled({ env }, { limit: 2 })),
				runStep('nexoraTokenRefresh', () => onboardingRefreshScheduler.runScheduledRefresh({ env }, { limit: 5 })),
				runStep('nexoraInitialSync', () => onboardingSync.runScheduledSync({ env }, { limit: 5 })),
				runStep('nexoraBackgroundSync', () => onboardingSync.runScheduledBackgroundSync({ env }, { limit: 5 })),
				runStep('classificationIntelligence', () => classificationIntelligenceService.monitorScheduled({ env }, { limit: 2 })),
			]);
			return;
		}

		await Promise.allSettled([
			runStep('outboundDrain', () => outboundService.drain({ env }, (cc, payload, uid) => emailService.send(cc, payload, uid))),
			runStep('clearRecord', () => verifyRecordService.clearRecord({ env })),
			runStep('resetDaySendCount', () => userService.resetDaySendCount({ env })),
			runStep('completeReceiveAll', () => emailService.completeReceiveAll({ env })),
			runStep('clearNoBindOauth', () => oauthService.clearNoBindOathUser({ env })),
			runStep('echartsCache', () => analysisService.refreshEchartsCache({ env })),
			runStep('syncRouting', () => cloudMailV2Service.syncRouting({ env, req: { header: () => null } })),
			runStep('nexoraAutonomy', () => nexoraV3Service.monitorScheduled({ env }, { limit: 10 })),
			runStep('durableMissionRuntime', () => durableMissionRuntimeService.monitorScheduled({ env }, { limit: 2 })),
			runStep('nexoraTokenRefresh', () => onboardingRefreshScheduler.runScheduledRefresh({ env }, { limit: 5 })),
			runStep('nexoraInitialSync', () => onboardingSync.runScheduledSync({ env }, { limit: 5 })),
			runStep('nexoraBackgroundSync', () => onboardingSync.runScheduledBackgroundSync({ env }, { limit: 5 })),
			runStep('classificationIntelligence', () => classificationIntelligenceService.monitorScheduled({ env }, { limit: 2 })),
			runStep('unifiedConversation', () => unifiedConversationBackfillService.monitorScheduled({ env }, { limit: 10 })),
		]);
	},
};
