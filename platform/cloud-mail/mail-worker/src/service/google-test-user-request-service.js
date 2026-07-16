import BizError from '../error/biz-error';

const PENDING = 'pending_google_test_user';
const APPROVED_WAITING_GOOGLE_SYNC = 'approved_waiting_google_sync';
const GOOGLE_SYNCED = 'google_synced';
const OAUTH_SUCCESS = 'oauth_success';
const OAUTH_FAILED = 'oauth_failed';
const REJECTED = 'rejected';
const STATUSES = new Set([PENDING, APPROVED_WAITING_GOOGLE_SYNC, GOOGLE_SYNCED, OAUTH_SUCCESS, OAUTH_FAILED, REJECTED]);
const AUTO_APPROVED_NOTE = 'cloudmail_governance=auto_approved';
const ENTERPRISE_PENDING_NOTE = 'enterprise_policy_requires_approval=true';

function normalizeEmail(value) {
	return String(value || '').trim().toLowerCase();
}

function bounded(value, limit = 300) {
	const text = String(value || '').trim();
	return text ? text.slice(0, limit) : null;
}

function classifyGoogleOAuthFailure(error, description = '') {
	const haystack = `${error || ''} ${description || ''}`.toLowerCase();
	if (haystack.includes('app_not_verified') || haystack.includes('verification')) return 'verification_required';
	if (haystack.includes('admin_policy') || haystack.includes('workspace') || haystack.includes('org_internal')) return 'workspace_admin_blocked';
	if (haystack.includes('scope') || haystack.includes('not approved')) return 'scope_not_approved';
	if (haystack.includes('cancel')) return 'user_cancelled';
	if (haystack.includes('access_denied')) return 'testing_restricted';
	return 'unknown_error';
}

async function userEmailById(c, userId) {
	if (!userId) return null;
	try {
		const row = await c.env.db.prepare('SELECT email FROM user WHERE user_id = ?1 LIMIT 1').bind(userId).first();
		if (row?.email) return row.email;
	} catch (_) {
		// Some local schemas use users/id. Fall through to that legacy-safe lookup.
	}
	try {
		const row = await c.env.db.prepare('SELECT email FROM users WHERE id = ?1 LIMIT 1').bind(userId).first();
		return row?.email || null;
	} catch (_) {
		return null;
	}
}

function assertAdmin(c) {
	const adminEmail = normalizeEmail(c.env.admin || 'admin@fastonegroup.com');
	const userEmail = normalizeEmail(c.get('user')?.email);
	if (!userEmail || userEmail !== adminEmail) {
		throw new BizError('Only the CloudMail admin can manage Gmail testing requests.', 403);
	}
	return userEmail;
}

function csvCell(value) {
	const text = String(value ?? '');
	return `"${text.replace(/"/g, '""')}"`;
}

const googleTestUserRequestService = {
	PENDING,
	APPROVED_WAITING_GOOGLE_SYNC,
	GOOGLE_SYNCED,
	OAUTH_SUCCESS,
	OAUTH_FAILED,
	REJECTED,

	async recordAccessDenied(c, params = {}) {
		const state = String(params.state || '');
		const stored = state ? await c.env.kv.get(`gemini-oauth-state:${state}`, { type: 'json' }).catch(() => null) : null;
		const gmail = normalizeEmail(params.gmail || stored?.requestedGmail || stored?.gmail || stored?.accountEmail);
		if (!gmail) return { recorded: false, reason: 'gmail_not_available' };

		const userId = stored?.userId || params.userId || null;
		const userEmail = bounded(params.userEmail || await userEmailById(c, userId), 254);
		const device = bounded(params.device || stored?.device, 160);
		const userAgent = bounded(params.userAgent || c.req.header('user-agent'), 500);
		const oauthError = bounded(params.oauthError, 120);
		const oauthErrorDescription = bounded(params.oauthErrorDescription, 500);

		let finalStatus = OAUTH_FAILED;
		const existing = await c.env.db.prepare(
			`SELECT status FROM google_oauth_test_user_requests WHERE normalized_gmail = ?1 LIMIT 1`
		).bind(gmail).first();
		if (existing) {
			if (existing.status === APPROVED_WAITING_GOOGLE_SYNC || existing.status === GOOGLE_SYNCED) {
				finalStatus = existing.status;
			} else if (existing.status === OAUTH_SUCCESS) {
				finalStatus = OAUTH_FAILED;
			}
		}

		await c.env.db.prepare(
			`INSERT INTO google_oauth_test_user_requests
			   (gmail, normalized_gmail, user_id, user_email, device, user_agent,
			    oauth_error, oauth_error_description, status, notes)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
			 ON CONFLICT(normalized_gmail) DO UPDATE SET
			   gmail = excluded.gmail,
			   user_id = COALESCE(excluded.user_id, google_oauth_test_user_requests.user_id),
			   user_email = COALESCE(excluded.user_email, google_oauth_test_user_requests.user_email),
			   device = COALESCE(excluded.device, google_oauth_test_user_requests.device),
			   user_agent = COALESCE(excluded.user_agent, google_oauth_test_user_requests.user_agent),
			   oauth_error = excluded.oauth_error,
			   oauth_error_description = excluded.oauth_error_description,
			   status = CASE
			     WHEN google_oauth_test_user_requests.status IN ('approved_waiting_google_sync', 'google_synced') THEN google_oauth_test_user_requests.status
			     ELSE 'oauth_failed'
			   END,
			   notes = COALESCE(excluded.notes, google_oauth_test_user_requests.notes),
			   last_seen_at = CURRENT_TIMESTAMP,
			   request_count = google_oauth_test_user_requests.request_count + 1`
		).bind(
			gmail,
			gmail,
			userId,
			userEmail,
			device,
			userAgent,
			oauthError,
			oauthErrorDescription,
			OAUTH_FAILED,
			bounded(`${AUTO_APPROVED_NOTE}; google_oauth_state=${classifyGoogleOAuthFailure(oauthError, oauthErrorDescription)}; mailbox_state=not_ready`, 500)
		).run();

		return {
			recorded: true,
			gmail,
			status: finalStatus,
			cloudmailGovernance: 'auto_approved',
			googleOAuthState: classifyGoogleOAuthFailure(oauthError, oauthErrorDescription),
			mailboxState: 'not_ready',
			pendingApprovalCreated: false
		};
	},

	async recordAutoApproved(c, params = {}) {
		const gmail = normalizeEmail(params.gmail || params.email);
		if (!gmail || !gmail.includes('@')) return { recorded: false, reason: 'gmail_not_available' };
		const userId = params.userId || null;
		const userEmail = bounded(params.userEmail || await userEmailById(c, userId), 254);
		const device = bounded(params.device, 160);
		const userAgent = bounded(params.userAgent || c.req.header('user-agent'), 500);
		await c.env.db.prepare(
			`INSERT INTO google_oauth_test_user_requests
			   (gmail, normalized_gmail, user_id, user_email, device, user_agent, status, notes)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'approved_waiting_google_sync', ?7)
			 ON CONFLICT(normalized_gmail) DO UPDATE SET
			   gmail = excluded.gmail,
			   user_id = COALESCE(excluded.user_id, google_oauth_test_user_requests.user_id),
			   user_email = COALESCE(excluded.user_email, google_oauth_test_user_requests.user_email),
			   device = COALESCE(excluded.device, google_oauth_test_user_requests.device),
			   user_agent = COALESCE(excluded.user_agent, google_oauth_test_user_requests.user_agent),
			   status = CASE
			     WHEN google_oauth_test_user_requests.status IN ('oauth_success', 'google_synced') THEN google_oauth_test_user_requests.status
			     WHEN google_oauth_test_user_requests.status = 'rejected' AND google_oauth_test_user_requests.notes LIKE '%enterprise_policy_requires_approval=true%' THEN google_oauth_test_user_requests.status
			     ELSE 'approved_waiting_google_sync'
			   END,
			   notes = COALESCE(excluded.notes, google_oauth_test_user_requests.notes),
			   last_seen_at = CURRENT_TIMESTAMP,
			   request_count = google_oauth_test_user_requests.request_count + 1`
		).bind(
			gmail,
			gmail,
			userId,
			userEmail,
			device,
			userAgent,
			bounded(`${AUTO_APPROVED_NOTE}; google_oauth_state=oauth_launch_ready; mailbox_state=not_ready`, 500)
		).run();
		return {
			recorded: true,
			gmail,
			status: APPROVED_WAITING_GOOGLE_SYNC,
			cloudmailGovernance: 'auto_approved',
			googleOAuthState: 'oauth_launch_ready',
			mailboxState: 'not_ready'
		};
	},

	async requestAccess(c, params = {}) {
		const gmail = normalizeEmail(params.gmail || params.email);
		if (!gmail || !gmail.includes('@')) throw new BizError('A Gmail address is required.', 400);
		const user = c.get('user') || {};
		const userId = user.userId || user.id || params.userId || null;
		const userEmail = bounded(params.userEmail || user.email || await userEmailById(c, userId), 254);
		const device = bounded(params.device, 160);
		const userAgent = bounded(params.userAgent || c.req.header('user-agent'), 500);
		const notes = bounded(params.notes || 'Requested from CloudMail iOS OAuth diagnostics.', 500);
		
		const isEnterprise = notes.includes('enterprise_policy_requires_approval=true') || gmail.endsWith('.corp') || gmail.includes('enterprise');
		const initialStatus = isEnterprise ? 'pending_google_test_user' : 'auto_approved';
		
		await c.env.db.prepare(
			`INSERT INTO google_oauth_test_user_requests
			   (gmail, normalized_gmail, user_id, user_email, device, user_agent, status, notes)
			 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
			 ON CONFLICT(normalized_gmail) DO UPDATE SET
			   gmail = excluded.gmail,
			   user_id = COALESCE(excluded.user_id, google_oauth_test_user_requests.user_id),
			   user_email = COALESCE(excluded.user_email, google_oauth_test_user_requests.user_email),
			   device = COALESCE(excluded.device, google_oauth_test_user_requests.device),
			   user_agent = COALESCE(excluded.user_agent, google_oauth_test_user_requests.user_agent),
			   status = CASE
			     WHEN google_oauth_test_user_requests.status IN ('approved_waiting_google_sync', 'google_synced', 'oauth_success', 'auto_approved') THEN google_oauth_test_user_requests.status
			     ELSE ?7
			   END,
			   last_seen_at = CURRENT_TIMESTAMP,
			   request_count = google_oauth_test_user_requests.request_count + 1,
			   notes = COALESCE(excluded.notes, google_oauth_test_user_requests.notes)`
		).bind(
			gmail,
			gmail,
			userId,
			userEmail,
			device,
			userAgent,
			initialStatus,
			notes
		).run();
		return { recorded: true, gmail, status: initialStatus };
	},

	async list(c, params = {}) {
		assertAdmin(c);
		const status = String(params.status || '').trim();
		const limit = Math.min(Math.max(Number(params.limit || 100), 1), 500);
		if (status && STATUSES.has(status)) {
			const { results } = await c.env.db.prepare(
				`SELECT * FROM google_oauth_test_user_requests
				  WHERE status = ?1
				  ORDER BY requested_at DESC, id DESC
				  LIMIT ?2`
			).bind(status, limit).all();
			return results || [];
		}
		const { results } = await c.env.db.prepare(
			`SELECT * FROM google_oauth_test_user_requests
			  ORDER BY
			    CASE status
			      WHEN 'pending_google_test_user' THEN 0
			      WHEN 'approved_waiting_google_sync' THEN 1
			      WHEN 'google_synced' THEN 2
			      WHEN 'oauth_failed' THEN 3
			      WHEN 'oauth_success' THEN 4
			      ELSE 5
			    END,
			    requested_at DESC,
			    id DESC
			  LIMIT ?1`
		).bind(limit).all();
		return results || [];
	},

	async updateStatus(c, ids, status, notes = '') {
		const reviewedBy = assertAdmin(c);
		if (!STATUSES.has(status)) throw new BizError('Unsupported Gmail testing request status.', 400);
		const normalizedIds = Array.from(new Set((ids || []).map(id => Number(id)).filter(Number.isFinite)));
		if (normalizedIds.length === 0) throw new BizError('At least one request id is required.', 400);
		const placeholders = normalizedIds.map((_, index) => `?${index + 4}`).join(',');
		await c.env.db.prepare(
			`UPDATE google_oauth_test_user_requests
			    SET status = CASE
			          WHEN status = 'oauth_success' AND ?1 IN ('approved_waiting_google_sync', 'google_synced') THEN status
			          ELSE ?1
			        END,
			        reviewed_at = CURRENT_TIMESTAMP,
			        reviewed_by = ?2,
			        notes = COALESCE(?3, notes),
			        approved_at = CASE WHEN ?1 = 'approved_waiting_google_sync' THEN CURRENT_TIMESTAMP ELSE approved_at END,
			        approved_by = CASE WHEN ?1 = 'approved_waiting_google_sync' THEN ?2 ELSE approved_by END
			  WHERE id IN (${placeholders})`
		).bind(status, reviewedBy, bounded(notes, 500), ...normalizedIds).run();
		return { updated: normalizedIds.length, status };
	},

	async clearOAuthState(c, state) {
		if (!state) return;
		await c.env.kv.delete(`gemini-oauth-state:${state}`).catch(() => {});
	},

	async approveAll(c) {
		const reviewedBy = assertAdmin(c);
		const result = await c.env.db.prepare(
			`UPDATE google_oauth_test_user_requests
			    SET status = 'approved_waiting_google_sync',
			        reviewed_at = CURRENT_TIMESTAMP,
			        reviewed_by = ?1,
			        approved_at = CURRENT_TIMESTAMP,
			        approved_by = ?1
			  WHERE status = 'pending_google_test_user'`
		).bind(reviewedBy).run();
		return { updated: result.meta?.changes || 0, status: APPROVED_WAITING_GOOGLE_SYNC };
	},

	async markGoogleSynced(c, ids = [], params = {}) {
		const operator = assertAdmin(c);
		const normalizedIds = Array.from(new Set((ids || []).map(id => Number(id)).filter(Number.isFinite)));
		const batchId = bounded(params.googleSyncBatchId || params.batchId || `google-test-users-${Date.now()}`, 120);
		const notes = bounded(params.googleSyncNotes || params.notes, 500);
		const where = normalizedIds.length
			? `id IN (${normalizedIds.map((_, index) => `?${index + 4}`).join(',')})`
			: `status = 'approved_waiting_google_sync'`;
		const result = await c.env.db.prepare(
			`UPDATE google_oauth_test_user_requests
				    SET status = 'google_synced',
			        last_google_export = COALESCE(last_google_export, CURRENT_TIMESTAMP),
			        last_google_sync_operator = ?1,
			        google_sync_batch_id = ?2,
			        google_sync_notes = COALESCE(?3, google_sync_notes),
			        reviewed_at = CURRENT_TIMESTAMP,
			        reviewed_by = ?1
			  WHERE ${where}`
		).bind(operator, batchId, notes, ...normalizedIds).run();
		return { updated: result.meta?.changes || 0, status: GOOGLE_SYNCED, googleSyncBatchId: batchId };
	},

	async recordExport(c, params = {}) {
		const operator = assertAdmin(c);
		const status = String(params.status || PENDING).trim();
		const targetStatus = STATUSES.has(status) ? status : PENDING;
		const result = await c.env.db.prepare(
			`UPDATE google_oauth_test_user_requests
			    SET last_google_export = CURRENT_TIMESTAMP,
			        last_google_sync_operator = ?1
			  WHERE status = ?2`
		).bind(operator, targetStatus).run();
		return { updated: result.meta?.changes || 0, status: targetStatus };
	},

	async recordOAuthSuccess(c, gmail, params = {}) {
		const normalized = normalizeEmail(gmail);
		if (!normalized) return { recorded: false };
		await c.env.db.prepare(
			`INSERT INTO google_oauth_test_user_requests
			   (gmail, normalized_gmail, user_id, status, notes, oauth_success_time, first_mailbox_created, last_active)
			 VALUES (?1, ?1, ?2, 'oauth_success', ?3, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
			 ON CONFLICT(normalized_gmail) DO UPDATE SET
			    status = 'oauth_success',
			    oauth_success_time = COALESCE(google_oauth_test_user_requests.oauth_success_time, CURRENT_TIMESTAMP),
			    first_mailbox_created = COALESCE(google_oauth_test_user_requests.first_mailbox_created, CURRENT_TIMESTAMP),
			    last_active = CURRENT_TIMESTAMP,
			    oauth_error = NULL,
			    oauth_error_description = NULL,
			    notes = COALESCE(google_oauth_test_user_requests.notes, excluded.notes)`
		).bind(normalized, params.userId || null, bounded(`${AUTO_APPROVED_NOTE}; google_oauth_state=oauth_success; mailbox_state=importing`, 500)).run();
		return {
			recorded: true,
			gmail: normalized,
			status: OAUTH_SUCCESS,
			cloudmailGovernance: 'auto_approved',
			googleOAuthState: 'oauth_success',
			mailboxState: 'importing'
		};
	},

	async recordFirstSync(c, gmail) {
		const normalized = normalizeEmail(gmail);
		if (!normalized) return { recorded: false };
		await c.env.db.prepare(
			`UPDATE google_oauth_test_user_requests
				    SET status = 'google_synced',
				        first_sync_at = COALESCE(first_sync_at, CURRENT_TIMESTAMP),
				        first_sync_completed = COALESCE(first_sync_completed, CURRENT_TIMESTAMP),
				        oauth_success_time = COALESCE(oauth_success_time, CURRENT_TIMESTAMP),
				        last_google_export = COALESCE(last_google_export, CURRENT_TIMESTAMP),
				        last_google_sync_operator = COALESCE(last_google_sync_operator, 'cloudmail-gmail-rest-sync'),
				        google_sync_batch_id = COALESCE(google_sync_batch_id, 'cloudmail-first-sync'),
				        google_sync_notes = COALESCE(google_sync_notes, 'First Gmail REST sync completed by CloudMail.'),
				        last_active = CURRENT_TIMESTAMP
				  WHERE normalized_gmail = ?1`
		).bind(normalized).run();
		return { recorded: true, gmail: normalized };
	},

	async dashboard(c) {
		assertAdmin(c);
		const counts = await c.env.db.prepare(
			`SELECT
			   SUM(CASE WHEN status = 'pending_google_test_user' THEN 1 ELSE 0 END) AS pendingRequests,
			   SUM(CASE WHEN status IN ('approved_waiting_google_sync','google_synced','oauth_success') THEN 1 ELSE 0 END) AS approvedRequests,
			   SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END) AS rejectedRequests,
			   SUM(CASE WHEN requested_at >= date('now') THEN 1 ELSE 0 END) AS newToday,
			   SUM(CASE WHEN requested_at >= datetime('now', '-7 days') THEN 1 ELSE 0 END) AS newThisWeek,
			   SUM(CASE WHEN status = 'oauth_success' THEN 1 ELSE 0 END) AS oauthSuccess,
			   SUM(CASE WHEN status = 'oauth_failed' THEN 1 ELSE 0 END) AS oauthFailures,
			   SUM(CASE WHEN request_count > 1 THEN 1 ELSE 0 END) AS repeatRequests,
			   AVG(CASE
			     WHEN approved_at IS NOT NULL
			     THEN (julianday(approved_at) - julianday(requested_at)) * 24 * 60
			     ELSE NULL
			   END) AS averageApprovalMinutes
			 FROM google_oauth_test_user_requests`
		).first();
		const success = Number(counts?.oauthSuccess || 0);
		const failed = Number(counts?.oauthFailures || 0);
		const totalAttempts = success + failed;
		return {
			pendingRequests: Number(counts?.pendingRequests || 0),
			approvedRequests: Number(counts?.approvedRequests || 0),
			rejectedRequests: Number(counts?.rejectedRequests || 0),
			newToday: Number(counts?.newToday || 0),
			newThisWeek: Number(counts?.newThisWeek || 0),
			oauthSuccessRate: totalAttempts ? Math.round((success / totalAttempts) * 10000) / 100 : 0,
			averageApprovalMinutes: counts?.averageApprovalMinutes == null
				? null
				: Math.round(Number(counts.averageApprovalMinutes) * 10) / 10,
			oauthSuccess: success,
			oauthFailures: failed,
			repeatRequests: Number(counts?.repeatRequests || 0)
		};
	},

	async gmailList(c, params = {}) {
		const status = String(params.status || APPROVED_WAITING_GOOGLE_SYNC).trim();
		const rows = await this.list(c, { status, limit: params.limit || 500 });
		await this.recordExport(c, { status });
		return rows.map(row => row.gmail).filter(Boolean);
	},

	async csv(c, params = {}) {
		const rows = await this.list(c, { status: params.status, limit: params.limit || 500 });
		await this.recordExport(c, { status: params.status || PENDING });
		const header = [
			'gmail',
			'status',
			'user_email',
			'device',
			'requested_at',
			'last_seen_at',
			'approved_at',
			'approved_by',
			'last_google_export',
			'last_google_sync_operator',
			'google_sync_batch_id',
			'oauth_success_time',
			'first_sync_completed',
			'request_count',
			'notes'
		];
		const lines = [
			header.join(','),
			...rows.map(row => header.map(key => csvCell(row[key])).join(','))
		];
		return lines.join('\n');
	},

	async markdownReport(c, params = {}) {
		assertAdmin(c);
		const period = String(params.period || 'daily').toLowerCase() === 'weekly' ? 'weekly' : 'daily';
		const since = period === 'weekly' ? "-7 days" : "-1 day";
		const rows = (await c.env.db.prepare(
			`SELECT * FROM google_oauth_test_user_requests
			  WHERE requested_at >= datetime('now', ?1)
			     OR last_seen_at >= datetime('now', ?1)
			     OR reviewed_at >= datetime('now', ?1)
			     OR oauth_success_time >= datetime('now', ?1)
			  ORDER BY requested_at DESC, id DESC`
		).bind(since).all()).results || [];
		const dashboard = await this.dashboard(c);
		const title = period === 'weekly' ? 'Google Test User Weekly Report' : 'Google Test User Daily Report';
		const lines = [
			`# ${title}`,
			'',
			`Generated: ${new Date().toISOString()}`,
			'',
			'```text',
			`Pending=${dashboard.pendingRequests}`,
			`Approved=${dashboard.approvedRequests}`,
			`Rejected=${dashboard.rejectedRequests}`,
			`OAuth Success=${dashboard.oauthSuccess}`,
			`OAuth Failures=${dashboard.oauthFailures}`,
			`Repeat Requests=${dashboard.repeatRequests}`,
			`OAuth Success Rate=${dashboard.oauthSuccessRate}%`,
			'```',
			'',
			'| Gmail | Status | Requests | User | Last Seen | Notes |',
			'| --- | --- | ---: | --- | --- | --- |',
			...rows.map(row => `| ${row.gmail || ''} | ${row.status || ''} | ${row.request_count || 0} | ${row.user_email || ''} | ${row.last_seen_at || ''} | ${(row.notes || '').replace(/\|/g, '/')} |`)
		];
		return lines.join('\n');
	}
};

export default googleTestUserRequestService;
