import providerRuntimeConfigLoader from './provider-runtime-config-loader';
import { decryptSecret, encryptSecret } from '../utils/secret-crypto';

const SYNTHETIC_PROMPTS = {
	ping: 'Reply with exactly: CloudMail synthetic ping ok.',
	summarize_synthetic: 'Summarize this synthetic message: The CloudMail test mailbox received a mock update. No action is required.',
	draft_synthetic: 'Draft a short synthetic reply confirming receipt of a mock CloudMail test update.',
	translate_synthetic: 'Translate this synthetic sentence to French: CloudMail test message received.',
	workspace_summarize: 'Summarize this synthetic email: Project Alpha meeting moved from 2 PM to 4 PM. Please reply with a one sentence summary.',
	workspace_draft: 'Draft a concise synthetic workspace note confirming a mock CloudMail setup update was received.',
	workspace_translate: 'Translate this synthetic CloudMail workspace sentence to French: The mock workspace action completed successfully.',
	workspace_reply_suggestion: 'Suggest a short synthetic reply to this mock workspace message: Thank you for the setup update.',
	workspace_thread_analysis: 'Analyze this synthetic CloudMail workspace thread: one mock setup update, one mock acknowledgement, no action required.'
};

function syntheticPrompt(promptClass) {
	return SYNTHETIC_PROMPTS[promptClass] || null;
}

async function withTimeout(promise, timeoutMs) {
	const timeout = new Promise((_, reject) => {
		setTimeout(() => reject(Object.assign(new Error('Provider request timed out.'), { code: 'timeout' })), timeoutMs);
	});
	return Promise.race([promise, timeout]);
}

function tokenExpired(row, skewSeconds = 90) {
	const expiresAt = Number(row?.expires_at || 0);
	return !expiresAt || expiresAt <= Math.floor(Date.now() / 1000) + skewSeconds;
}

async function tokenRefreshRequest(c, refreshToken) {
	if (!c.env.GOOGLE_OAUTH_CLIENT_ID || !c.env.GOOGLE_OAUTH_CLIENT_SECRET) {
		throw Object.assign(new Error('Google OAuth client is not configured for token refresh.'), { code: 'oauth_client_not_configured' });
	}
	const response = await fetch('https://oauth2.googleapis.com/token', {
		method: 'POST',
		headers: { 'content-type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({
			client_id: c.env.GOOGLE_OAUTH_CLIENT_ID,
			client_secret: c.env.GOOGLE_OAUTH_CLIENT_SECRET,
			refresh_token: refreshToken,
			grant_type: 'refresh_token'
		})
	});
	const body = await response.json().catch(() => ({}));
	if (!response.ok) throw Object.assign(new Error(`Gemini OAuth refresh returned HTTP ${response.status}.`), { code: 'oauth_refresh_failed' });
	return body;
}

async function loadUserGeminiToken(c, forceRefresh = false) {
	const user = c.get('user');
	if (!user?.userId) throw Object.assign(new Error('Authenticated user is required for Gemini OAuth runtime.'), { code: 'user_required' });
	const row = await c.env.db.prepare(
		`SELECT access_token_ciphertext, refresh_token_ciphertext, scope, token_type, expires_at
		   FROM ai_provider_tokens
		  WHERE user_id = ?1 AND provider = 'google_gemini' AND status = 'connected'
		  LIMIT 1`
	).bind(user.userId).first();
	if (!row?.access_token_ciphertext) throw Object.assign(new Error('Gemini OAuth token reference is not connected for this user.'), { code: 'user_oauth_token_unavailable' });

	if (!forceRefresh && !tokenExpired(row)) {
		return { accessToken: await decryptSecret(c, row.access_token_ciphertext), refreshed: false };
	}
	if (!row.refresh_token_ciphertext) {
		return { accessToken: await decryptSecret(c, row.access_token_ciphertext), refreshed: false };
	}

	const refreshToken = await decryptSecret(c, row.refresh_token_ciphertext);
	const token = await tokenRefreshRequest(c, refreshToken);
	const accessCiphertext = token.access_token ? await encryptSecret(c, token.access_token) : row.access_token_ciphertext;
	const expiresAt = token.expires_in ? Math.floor(Date.now() / 1000) + Number(token.expires_in) : row.expires_at;
	await c.env.db.prepare(
		`UPDATE ai_provider_tokens
		    SET access_token_ciphertext = ?1,
		        scope = COALESCE(?2, scope),
		        token_type = COALESCE(?3, token_type),
		        expires_at = ?4,
		        updated_at = CURRENT_TIMESTAMP
		  WHERE user_id = ?5 AND provider = 'google_gemini' AND status = 'connected'`
	).bind(
		accessCiphertext,
		token.scope || null,
		token.token_type || null,
		expiresAt,
		user.userId
	).run();

	return { accessToken: token.access_token || await decryptSecret(c, accessCiphertext), refreshed: true };
}

async function fetchGeminiGenerateContent(modelAlias, headers, prompt, timeoutMs) {
	const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelAlias)}:generateContent`;
	const response = await withTimeout(fetch(url, {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...headers },
		body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
	}), timeoutMs);
	if (!response.ok) {
		const text = await response.text().catch(() => '');
		let parsed = {};
		try {
			parsed = text ? JSON.parse(text) : {};
		} catch (_) {
			parsed = {};
		}
		const providerError = parsed?.error || {};
		throw Object.assign(new Error(`Gemini returned HTTP ${response.status}.`), {
			code: 'provider_http_error',
			status: response.status,
			provider_error: {
				http_status: response.status,
				status: providerError.status || null,
				code: providerError.code || null,
				message: providerError.message || null,
				details: Array.isArray(providerError.details)
					? providerError.details.map(detail => ({
						type: detail['@type'] || null,
						reason: detail.reason || null,
						domain: detail.domain || null,
						metadata: detail.metadata || null,
						violations: detail.violations || null
					}))
					: []
			}
		});
	}
	const body = await response.json();
	return body?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

class ProviderRuntimeAdapter {
	constructor(config) {
		this.config = config;
	}
	async preflight() {
		throw Object.assign(new Error('Provider adapter is not implemented.'), { code: 'adapter_not_implemented' });
	}
}

class GeminiRuntimeAdapter extends ProviderRuntimeAdapter {
	async preflight(c, promptClass) {
		const prompt = syntheticPrompt(promptClass);
		if (this.config.method_id === 'gemini_oauth_reference') {
			const token = await loadUserGeminiToken(c);
			try {
				return await fetchGeminiGenerateContent(this.config.model_alias, { authorization: `Bearer ${token.accessToken}` }, prompt, this.config.timeout_ms);
			} catch (error) {
				if (error?.status !== 401) throw error;
				const refreshed = await loadUserGeminiToken(c, true);
				return fetchGeminiGenerateContent(this.config.model_alias, { authorization: `Bearer ${refreshed.accessToken}` }, prompt, this.config.timeout_ms);
			}
		}
		const key = providerRuntimeConfigLoader.resolveSecret(c.env, 'google_gemini');
		if (!key) throw Object.assign(new Error('Gemini credential reference is not executable.'), { code: 'credential_secret_unavailable' });
		return fetchGeminiGenerateContent(this.config.model_alias, { 'x-goog-api-key': key }, prompt, this.config.timeout_ms);
	}
}

class OpenAIRuntimeAdapter extends ProviderRuntimeAdapter {
	async preflight(c, promptClass) {
		const prompt = syntheticPrompt(promptClass);
		const key = providerRuntimeConfigLoader.resolveSecret(c.env, 'openai');
		if (!key) throw Object.assign(new Error('OpenAI credential reference is not executable.'), { code: 'credential_secret_unavailable' });
		const response = await withTimeout(fetch('https://api.openai.com/v1/responses', {
			method: 'POST',
			headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
			body: JSON.stringify({ model: this.config.model_alias, input: prompt, max_output_tokens: 160 })
		}), this.config.timeout_ms);
		if (!response.ok) throw Object.assign(new Error(`OpenAI returned HTTP ${response.status}.`), { code: 'provider_http_error' });
		const body = await response.json();
		return body?.output_text || body?.output?.[0]?.content?.[0]?.text || '';
	}
}

class AzureOpenAIRuntimeAdapter extends ProviderRuntimeAdapter {
	async preflight() {
		throw Object.assign(new Error('Azure OpenAI runtime adapter requires deployment endpoint metadata.'), { code: 'azure_endpoint_unavailable' });
	}
}

const providerRuntimeAdapters = {
	create(config) {
		if (config.provider_id === 'google_gemini') return new GeminiRuntimeAdapter(config);
		if (config.provider_id === 'openai') return new OpenAIRuntimeAdapter(config);
		if (config.provider_id === 'azure_openai') return new AzureOpenAIRuntimeAdapter(config);
		return new ProviderRuntimeAdapter(config);
	},
	syntheticPrompt
};

export { ProviderRuntimeAdapter, GeminiRuntimeAdapter, OpenAIRuntimeAdapter, AzureOpenAIRuntimeAdapter };
export default providerRuntimeAdapters;
