import providerRuntimeConfigLoader from './provider-runtime-config-loader';
import providerRuntimeAdapters from './provider-runtime-adapters';
import providerRuntimeAuditLogger from './provider-runtime-audit-logger';
import providerRuntimeErrorMapper from './provider-runtime-error-mapper';
import providerRuntimeRedactor from './provider-runtime-redactor';

const ALLOWED_PROMPT_CLASSES = new Set([
	'ping',
	'summarize_synthetic',
	'draft_synthetic',
	'translate_synthetic',
	'workspace_summarize',
	'workspace_draft',
	'workspace_translate',
	'workspace_reply_suggestion',
	'workspace_thread_analysis'
]);

const WORKSPACE_ACTION_PROMPTS = {
	summarize: 'workspace_summarize',
	draft: 'workspace_draft',
	translate: 'workspace_translate',
	reply_suggestion: 'workspace_reply_suggestion',
	thread_analysis: 'workspace_thread_analysis'
};

const DISALLOWED_WORKSPACE_PAYLOAD_KEYS = new Set([
	'prompt',
	'body',
	'content',
	'message',
	'email',
	'mailbox',
	'attachment',
	'attachments',
	'contact',
	'contacts',
	'calendar',
	'customer',
	'thread'
]);

function hasDisallowedWorkspacePayload(params = {}) {
	return Object.keys(params).some(key => !['action', 'provider_id', 'providerId'].includes(key) && DISALLOWED_WORKSPACE_PAYLOAD_KEYS.has(key));
}

function workspaceProviderConfig(params = {}) {
	const explicitProvider = params.provider_id || params.providerId;
	const providerId = String(explicitProvider || 'google_gemini').trim();
	if (providerId === 'openai') {
		return {
			provider_id: 'openai',
			method_id: 'openai_project_api_key_reference',
			runtime_auth_source: 'platform_api_key',
			billing_owner: 'platform',
			provider_ownership: 'platform_managed',
			shared_platform_api_key: true
		};
	}
	if (providerId === 'google_gemini') return {
		provider_id: 'google_gemini',
		method_id: 'gemini_oauth_reference',
		runtime_auth_source: 'user_oauth_token',
		billing_owner: 'user',
		provider_ownership: 'user_owned',
		shared_platform_api_key: false
	};
	return {
		provider_id: providerId || null,
		method_id: null,
		runtime_auth_source: null,
		billing_owner: null,
		provider_ownership: null,
		shared_platform_api_key: false,
		unsupported: true
	};
}

const providerRuntimeRouter = {
	async preflight(c, params = {}) {
		const started = Date.now();
		const requestId = crypto.randomUUID();
		const promptClass = String(params.synthetic_prompt_class || params.syntheticPromptClass || '');
		if (!ALLOWED_PROMPT_CLASSES.has(promptClass)) {
			const auditId = await providerRuntimeAuditLogger.record(c, {
				action: 'ai_runtime_preflight_rejected',
				outcome: 'blocked',
				reason: 'unsupported_synthetic_prompt_class',
				request_id: requestId
			});
			return this.blocked('unsupported_synthetic_prompt_class', requestId, auditId, started);
		}

		const config = providerRuntimeConfigLoader.load(c.env, params);
		if (!config.flags.syntheticPreflightEnabled) {
			const auditId = await providerRuntimeAuditLogger.record(c, {
				action: 'ai_runtime_preflight_blocked',
				outcome: 'blocked',
				reason: 'synthetic_preflight_disabled',
				request_id: requestId
			});
			return this.blocked('synthetic_preflight_disabled', requestId, auditId, started, config);
		}
		if (config.reason === 'unsupported_provider' || config.reason === 'unsupported_method') {
			const auditId = await providerRuntimeAuditLogger.record(c, {
				action: 'ai_runtime_preflight_rejected',
				outcome: 'blocked',
				reason: config.reason,
				provider_id: config.provider_id,
				method_id: config.method_id,
				request_id: requestId
			});
			return this.blocked(config.reason, requestId, auditId, started, config);
		}
		if (config.reason === 'BLOCKED_AI_PROVIDER_CREDENTIAL_REFERENCE_REQUIRED') {
			const auditId = await providerRuntimeAuditLogger.record(c, {
				action: 'ai_runtime_preflight_blocked',
				outcome: 'blocked',
				reason: 'BLOCKED_AI_PROVIDER_CREDENTIAL_REFERENCE_REQUIRED',
				provider_id: config.provider_id,
				method_id: config.method_id,
				request_id: requestId
			});
			return this.blocked('BLOCKED_AI_PROVIDER_CREDENTIAL_REFERENCE_REQUIRED', requestId, auditId, started, config);
		}
		if (!config.flags.runtimeExperimental) {
			const auditId = await providerRuntimeAuditLogger.record(c, {
				action: 'ai_runtime_preflight_blocked',
				outcome: 'blocked',
				reason: 'runtime_experimental_disabled',
				provider_id: config.provider_id,
				method_id: config.method_id,
				request_id: requestId
			});
			return this.blocked('runtime_experimental_disabled', requestId, auditId, started, config);
		}
		if (!config.provider_enabled) {
			const auditId = await providerRuntimeAuditLogger.record(c, {
				action: 'ai_runtime_preflight_blocked',
				outcome: 'blocked',
				reason: 'provider_disabled',
				provider_id: config.provider_id,
				method_id: config.method_id,
				request_id: requestId
			});
			return this.blocked('provider_disabled', requestId, auditId, started, config);
		}
		if (!config.ok || !config.credential_secret_present) {
			const reason = config.reason === 'BLOCKED_AI_PROVIDER_CREDENTIAL_REFERENCE_REQUIRED'
				? 'BLOCKED_AI_PROVIDER_CREDENTIAL_REFERENCE_REQUIRED'
				: config.reason || 'credential_secret_unavailable';
			const auditId = await providerRuntimeAuditLogger.record(c, {
				action: 'ai_runtime_preflight_blocked',
				outcome: 'blocked',
				reason,
				provider_id: config.provider_id,
				method_id: config.method_id,
				request_id: requestId
			});
			return this.blocked(reason, requestId, auditId, started, config);
		}
		if (config.flags.productionDataAllowed || config.flags.mailboxDataAllowed) {
			const auditId = await providerRuntimeAuditLogger.record(c, {
				action: 'ai_runtime_preflight_rejected',
				outcome: 'blocked',
				reason: 'unsafe_data_flags_enabled',
				provider_id: config.provider_id,
				request_id: requestId
			});
			return this.blocked('unsafe_data_flags_enabled', requestId, auditId, started, config);
		}

		try {
			const adapter = providerRuntimeAdapters.create(config);
			const output = await adapter.preflight(c, promptClass);
			const auditId = await providerRuntimeAuditLogger.record(c, {
				action: 'ai_runtime_preflight',
				outcome: 'success',
				provider_id: config.provider_id,
				method_id: config.method_id,
				model_alias: config.model_alias,
				synthetic_prompt_class: promptClass,
				request_id: requestId,
				latency_ms: Date.now() - started
			});
			return {
				provider_reachable: true,
				model_reachable: true,
				sanitized_output_preview: String(providerRuntimeRedactor.redact(output || '')).slice(0, 240),
				latency_ms: Date.now() - started,
				request_id: requestId,
				audit_id: auditId,
				status: 'ready',
				runtime_auth_source: config.runtime_auth_source || null,
				billing_owner: config.billing_owner || null,
				provider_ownership: config.provider_ownership || null,
				shared_platform_api_key: Boolean(config.shared_platform_api_key)
			};
		} catch (error) {
			const mapped = providerRuntimeErrorMapper.map(error);
			const auditId = await providerRuntimeAuditLogger.record(c, {
				action: 'ai_runtime_preflight',
				outcome: 'failed',
				provider_id: config.provider_id,
				method_id: config.method_id,
				request_id: requestId,
				error_code: mapped.code
			});
			return {
				provider_reachable: false,
				model_reachable: false,
				sanitized_output_preview: '',
				latency_ms: Date.now() - started,
				request_id: requestId,
				audit_id: auditId,
				status: 'failed',
				runtime_auth_source: config.runtime_auth_source || null,
				billing_owner: config.billing_owner || null,
				provider_ownership: config.provider_ownership || null,
				shared_platform_api_key: Boolean(config.shared_platform_api_key),
				error: mapped
			};
		}
	},

	async workspaceAction(c, params = {}) {
		const started = Date.now();
		const requestId = crypto.randomUUID();
		const action = String(params.action || '').trim();
		const promptClass = WORKSPACE_ACTION_PROMPTS[action];
		const workspaceConfig = workspaceProviderConfig(params);
		if (workspaceConfig.unsupported) {
			const auditId = await providerRuntimeAuditLogger.record(c, {
				action: 'ai_workspace_action_rejected',
				outcome: 'blocked',
				reason: 'unsupported_workspace_provider',
				provider_id: workspaceConfig.provider_id,
				workspace_action: action,
				request_id: requestId
			});
			return this.blocked('unsupported_workspace_provider', requestId, auditId, started, workspaceConfig);
		}

		if (!promptClass) {
			const auditId = await providerRuntimeAuditLogger.record(c, {
				action: 'ai_workspace_action_rejected',
				outcome: 'blocked',
				reason: 'unsupported_workspace_action',
				request_id: requestId
			});
			return this.blocked('unsupported_workspace_action', requestId, auditId, started, {
				...workspaceConfig
			});
		}

		if (hasDisallowedWorkspacePayload(params)) {
			const auditId = await providerRuntimeAuditLogger.record(c, {
				action: 'ai_workspace_action_rejected',
				outcome: 'blocked',
				reason: 'workspace_payload_not_allowed',
				provider_id: workspaceConfig.provider_id,
				method_id: workspaceConfig.method_id,
				workspace_action: action,
				request_id: requestId
			});
			return this.blocked('workspace_payload_not_allowed', requestId, auditId, started, {
				...workspaceConfig
			});
		}

		const result = await this.preflight(c, {
			provider_id: workspaceConfig.provider_id,
			method_id: workspaceConfig.method_id,
			synthetic_prompt_class: promptClass
		});

		return {
			...result,
			provider_id: workspaceConfig.provider_id,
			method_id: workspaceConfig.method_id,
			workspace_action: action,
			user_initiated: true,
			mailbox_data_sent: false,
			customer_data_sent: false,
			contacts_sent: false,
			calendar_data_sent: false,
			attachments_sent: false,
			cross_account_access: false
		};
	},

	publicWorkspaceVerification(params = {}) {
		const action = String(params.action || '').trim();
		const promptClass = WORKSPACE_ACTION_PROMPTS[action];

		if (!promptClass) {
			return {
				status: 'blocked',
				reason: 'unsupported_workspace_action',
				verification_scope: 'public_synthetic_boundary',
				runtime_call_executed: false,
				auth_required_for_runtime: true,
				provider_id: 'google_gemini',
				method_id: 'gemini_oauth_reference',
				runtime_auth_source: 'user_oauth_token',
				billing_owner: 'user',
				provider_ownership: 'user_owned',
				shared_platform_api_key: false,
				cross_account_access: false
			};
		}

		if (hasDisallowedWorkspacePayload(params)) {
			return {
				status: 'blocked',
				reason: 'workspace_payload_not_allowed',
				workspace_action: action,
				verification_scope: 'public_synthetic_boundary',
				runtime_call_executed: false,
				auth_required_for_runtime: true,
				provider_id: 'google_gemini',
				method_id: 'gemini_oauth_reference',
				runtime_auth_source: 'user_oauth_token',
				billing_owner: 'user',
				provider_ownership: 'user_owned',
				shared_platform_api_key: false,
				cross_account_access: false
			};
		}

		return {
			status: 'ready',
			workspace_action: action,
			synthetic_prompt_class: promptClass,
			verification_scope: 'public_synthetic_boundary',
			runtime_call_executed: false,
			auth_required_for_runtime: true,
			user_initiated: true,
			mailbox_data_sent: false,
			customer_data_sent: false,
			contacts_sent: false,
			calendar_data_sent: false,
			attachments_sent: false,
			cross_account_access: false,
			provider_id: 'google_gemini',
			method_id: 'gemini_oauth_reference',
			runtime_auth_source: 'user_oauth_token',
			billing_owner: 'user',
			provider_ownership: 'user_owned',
			shared_platform_api_key: false
		};
	},

	blocked(reason, requestId, auditId, started, config = {}) {
		return {
			provider_reachable: false,
			model_reachable: false,
			sanitized_output_preview: '',
			latency_ms: Date.now() - started,
			request_id: requestId,
			audit_id: auditId,
			status: 'blocked',
			reason,
			provider_id: config.provider_id || null,
			method_id: config.method_id || null,
			runtime_auth_source: config.runtime_auth_source || null,
			billing_owner: config.billing_owner || null,
			provider_ownership: config.provider_ownership || null,
			shared_platform_api_key: Boolean(config.shared_platform_api_key)
		};
	}
};

export default providerRuntimeRouter;
