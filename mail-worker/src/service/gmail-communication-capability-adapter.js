const MAX_PAGE_SIZE = 20;
async function digest(value) { const bytes = new TextEncoder().encode(JSON.stringify(value)); const hash = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }

const gmailAdapter = Object.freeze({
	provider_id: 'gmail', adapter_id: 'gmail-canonical-d1-search-v1', adapter_version: '1.0.0', capabilities: Object.freeze(['search_email']),
	async invoke(c, context, request) {
		if (request.capability_id !== 'search_email') throw new Error('capability_unsupported');
		const query = String(request.query || '').trim();
		const pageSize = Number(request.page_size || 10);
		if (!query || query.length > 200) throw new Error('capability_schema_invalid_query');
		if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) throw new Error('capability_schema_invalid_page_size');
		const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
		const { results = [] } = await c.env.db.prepare(`SELECT e.email_id,e.external_message_id FROM email e JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id WHERE e.account_id=?1 AND e.user_id=?2 AND lower(a.provider) IN ('gmail','google') AND e.is_del=0 AND (e.subject LIKE ?3 ESCAPE '\\' OR e.send_email LIKE ?3 ESCAPE '\\' OR e.text LIKE ?3 ESCAPE '\\') ORDER BY e.email_id DESC LIMIT ?4`).bind(context.account_id, context.actor_user_id, pattern, pageSize).all();
		const messageRefs = results.map(row => `gmail:${context.account_id}:${row.external_message_id || row.email_id}`);
		return Object.freeze({ ok: true, response: Object.freeze({ capability_id: 'search_email', message_refs: Object.freeze(messageRefs), result_digest: await digest(messageRefs), provider_network_called: false, credential_accessed: false, mailbox_mutated: false }) });
	},
});
export default gmailAdapter;
