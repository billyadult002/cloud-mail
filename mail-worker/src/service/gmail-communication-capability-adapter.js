const MAX_PAGE_SIZE = 20;
async function digest(value) { const bytes = new TextEncoder().encode(JSON.stringify(value)); const hash = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join(''); }
const positiveInteger = value => Number.isSafeInteger(Number(value)) && Number(value) > 0;

const gmailAdapter = Object.freeze({
	provider_id: 'gmail', adapter_id: 'gmail-canonical-d1-search-v1', adapter_version: '1.0.0', capabilities: Object.freeze(['search_email']),
	async invoke(c, context, request) {
		if (request.capability_id !== 'search_email') throw new Error('capability_unsupported');
		if (!positiveInteger(context.tenant_id) || !positiveInteger(context.workspace_id) || !positiveInteger(context.actor_user_id) || !positiveInteger(context.account_id)) throw new Error('capability_adapter_scope_invalid');
		const query = String(request.query || '').trim();
		const pageSize = Number(request.page_size || 10);
		if (!query || query.length > 200) throw new Error('capability_schema_invalid_query');
		if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) throw new Error('capability_schema_invalid_page_size');
		const pattern = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
		const envelope = await c.env.db.prepare(`SELECT e.email_id,e.external_message_id,e.account_id,e.user_id,lower(a.provider) AS source_provider FROM email e JOIN account a ON a.account_id=e.account_id AND a.user_id=e.user_id WHERE e.account_id=?1 AND e.user_id=?2 AND a.is_del=0 AND lower(a.provider) IN ('gmail','google') AND e.is_del=0 AND (e.subject LIKE ?3 ESCAPE '\\' OR e.send_email LIKE ?3 ESCAPE '\\' OR e.text LIKE ?3 ESCAPE '\\') ORDER BY e.email_id DESC LIMIT ?4`).bind(context.account_id, context.actor_user_id, pattern, pageSize).all();
		if (!envelope || !Array.isArray(envelope.results) || envelope.results.length > pageSize) throw new Error('capability_adapter_response_invalid');
		const messageRefs = [];
		for (const row of envelope.results) {
			if (!row || !positiveInteger(row.email_id) || Number(row.account_id) !== Number(context.account_id) || Number(row.user_id) !== Number(context.actor_user_id) || !['gmail', 'google'].includes(row.source_provider) || (row.external_message_id !== null && row.external_message_id !== undefined && typeof row.external_message_id !== 'string')) throw new Error('capability_adapter_row_invalid');
			messageRefs.push(`msg_${await digest({ tenant_id: context.tenant_id, workspace_id: context.workspace_id, account_id: context.account_id, email_id: row.email_id, external_message_id: row.external_message_id || null })}`);
		}
		const response = {
			capability_id: 'search_email',
			message_refs: Object.freeze(messageRefs),
			scope: Object.freeze({ tenant_id: context.tenant_id, workspace_id: context.workspace_id, account_id: context.account_id }),
			source: Object.freeze({ type: 'canonical_synchronized_mail', provider: 'gmail', store: 'd1' }),
			provider_network_called: false,
			credential_accessed: false,
			mailbox_mutated: false,
		};
		return Object.freeze({ ok: true, response: Object.freeze({ ...response, result_digest: await digest(response) }) });
	},
});
export default gmailAdapter;
