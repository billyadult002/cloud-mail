import providerRuntimeRedactor from './provider-runtime-redactor';

function uuid() {
	return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const providerRuntimeAuditLogger = {
	async record(c, event) {
		const auditId = uuid();
		const safe = providerRuntimeRedactor.redact({
			...event,
			provider_namespace: event.provider_namespace || (event.provider_id ? `ai_provider.${event.provider_id}` : null),
			audit_id: auditId,
			created_at: new Date().toISOString()
		});
		try {
			const user = c.get('user');
			await c.env.db.prepare(
				`INSERT INTO audit_logs (user_id, actor_role, action, resource_type, outcome, metadata_json)
				 VALUES (?1, 'user', ?2, 'ai_runtime', ?3, ?4)`
			).bind(
				user?.userId || null,
				safe.action || 'ai_runtime_event',
				safe.outcome || 'recorded',
				JSON.stringify(safe)
			).run();
		} catch {
			// Audit storage must never expose details or break safe blocked responses.
		}
		return auditId;
	}
};

export default providerRuntimeAuditLogger;
