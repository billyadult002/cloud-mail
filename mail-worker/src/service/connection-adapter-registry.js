import gmailAdapter from './gmail-connection-adapter.js';

const adapters = new Map([['google', gmailAdapter]]);

function getConnectionAdapter(provider) {
	const adapter = adapters.get(String(provider || '').toLowerCase());
	if (!adapter) throw new Error('connection_provider_adapter_unavailable');
	return adapter;
}

export { getConnectionAdapter };
export default { getConnectionAdapter };
