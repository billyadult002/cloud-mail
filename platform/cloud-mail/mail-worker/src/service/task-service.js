// Loop 4 (Copilot Mail -> Task) service.
// Canonical task store per SINGLE_SOURCE_OF_TRUTH.md; tasks backlink to the
// originating mail via source_email_id. Raw prepared statements (mirrors
// outbound-service.js) so this service is self-contained and needs no ORM entity.
import BizError from '../error/biz-error';

const PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);
const KINDS = new Set(['task', 'deadline', 'meeting', 'approval', 'invoice', 'contract', 'payment']);
const STATUSES = new Set(['open', 'done', 'cancelled']);

function clampTitle(value) {
	const text = String(value || '').trim();
	if (!text) throw new BizError('Task title is required.', 400);
	return text.slice(0, 300);
}

function coercePriority(value) {
	const v = String(value || 'medium').toLowerCase();
	return PRIORITIES.has(v) ? v : 'medium';
}

function coerceKind(value) {
	const v = String(value || 'task').toLowerCase();
	return KINDS.has(v) ? v : 'task';
}

const taskService = {
	// Create a task directly. `params`: { title, priority?, kind?, dueDate?,
	// sourceEmailId?, sourceThreadId?, provider?, notes? }.
	async create(c, params, userId) {
		if (!userId) throw new BizError('Authentication required.', 401);
		const title = clampTitle(params?.title);
		const priority = coercePriority(params?.priority);
		const kind = coerceKind(params?.kind);
		const dueDate = params?.dueDate ? String(params.dueDate).slice(0, 40) : null;
		const sourceEmailId = params?.sourceEmailId != null ? Number(params.sourceEmailId) : null;
		const sourceThreadId = params?.sourceThreadId ? String(params.sourceThreadId).slice(0, 200) : null;
		const provider = params?.provider ? String(params.provider).slice(0, 60) : null;
		const notes = params?.notes ? String(params.notes).slice(0, 2000) : null;

		const res = await c.env.db.prepare(
			`INSERT INTO tasks
			   (user_id, title, priority, kind, due_date, status,
			    source_email_id, source_thread_id, provider, notes)
			 VALUES (?1, ?2, ?3, ?4, ?5, 'open', ?6, ?7, ?8, ?9)`
		).bind(userId, title, priority, kind, dueDate, sourceEmailId, sourceThreadId, provider, notes).run();

		return { id: res.meta?.last_row_id, title, priority, kind, dueDate, status: 'open', sourceEmailId };
	},

	// Create a task from a specific email. Verifies the email belongs to the user
	// before backlinking, so a task can never point at another user's mail.
	async createFromEmail(c, params, userId) {
		if (!userId) throw new BizError('Authentication required.', 401);
		const emailId = Number(params?.sourceEmailId ?? params?.emailId);
		if (!emailId) throw new BizError('sourceEmailId is required.', 400);
		const owns = await c.env.db.prepare(
			`SELECT 1 FROM email WHERE email_id = ?1 AND user_id = ?2 LIMIT 1`
		).bind(emailId, userId).first();
		if (!owns) throw new BizError('Source email not found for this user.', 404);
		return this.create(c, { ...params, sourceEmailId: emailId }, userId);
	},

	// List a user's tasks. `query`: { status?, size? }.
	async list(c, query, userId) {
		if (!userId) throw new BizError('Authentication required.', 401);
		const size = Math.min(Math.max(Number(query?.size) || 50, 1), 200);
		const status = query?.status && STATUSES.has(String(query.status)) ? String(query.status) : null;
		const stmt = status
			? c.env.db.prepare(
				`SELECT * FROM tasks WHERE user_id = ?1 AND status = ?2
				 ORDER BY (due_date IS NULL), due_date ASC, id DESC LIMIT ?3`
			).bind(userId, status, size)
			: c.env.db.prepare(
				`SELECT * FROM tasks WHERE user_id = ?1
				 ORDER BY (due_date IS NULL), due_date ASC, id DESC LIMIT ?2`
			).bind(userId, size);
		const rows = await stmt.all();
		return rows?.results || [];
	},

	// Tasks that backlink to a given email (for the Copilot panel).
	async listForEmail(c, emailId, userId) {
		if (!userId) throw new BizError('Authentication required.', 401);
		const rows = await c.env.db.prepare(
			`SELECT * FROM tasks WHERE user_id = ?1 AND source_email_id = ?2 ORDER BY id DESC`
		).bind(userId, Number(emailId)).all();
		return rows?.results || [];
	},

	// Update status (open/done/cancelled). Scoped to the owning user; the
	// conditional WHERE makes the transition the atomic gate (no check-then-act).
	async updateStatus(c, params, userId) {
		if (!userId) throw new BizError('Authentication required.', 401);
		const id = Number(params?.id);
		const status = String(params?.status || '');
		if (!id) throw new BizError('Task id is required.', 400);
		if (!STATUSES.has(status)) throw new BizError('Invalid status.', 400);
		const res = await c.env.db.prepare(
			`UPDATE tasks SET status = ?2, updated_at = CURRENT_TIMESTAMP
			 WHERE id = ?1 AND user_id = ?3`
		).bind(id, status, userId).run();
		if (!(res.meta?.changes > 0)) throw new BizError('Task not found for this user.', 404);
		return { id, status };
	}
};

export default taskService;
