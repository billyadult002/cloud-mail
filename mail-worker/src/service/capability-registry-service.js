const DESCRIPTORS = Object.freeze({
	search_email: Object.freeze({ capability_id: 'search_email', contract_version: '1.0.0', effect_class: 'read', authority_action: 'READ_MAIL', request_schema_id: 'nexora://capabilities/search_email/request/1', response_schema_id: 'nexora://capabilities/search_email/response/1' }),
});

function createCapabilityRegistry(adapters = []) {
	const byProvider = new Map();
	for (const adapter of adapters) for (const capabilityId of adapter.capabilities || []) {
		if (!DESCRIPTORS[capabilityId]) throw new Error('capability_descriptor_unknown');
		const key = `${adapter.provider_id}:${capabilityId}`;
		if (byProvider.has(key)) throw new Error('capability_adapter_duplicate');
		byProvider.set(key, adapter);
	}
	return Object.freeze({
		list: () => Object.values(DESCRIPTORS),
		describe(capabilityId) { const value = DESCRIPTORS[capabilityId]; if (!value) throw new Error('capability_unknown'); return value; },
		resolve(providerId, capabilityId) { this.describe(capabilityId); const adapter = byProvider.get(`${providerId}:${capabilityId}`); if (!adapter) throw new Error('capability_adapter_unavailable'); return adapter; },
	});
}

export { DESCRIPTORS, createCapabilityRegistry };
export default { DESCRIPTORS, createCapabilityRegistry };
