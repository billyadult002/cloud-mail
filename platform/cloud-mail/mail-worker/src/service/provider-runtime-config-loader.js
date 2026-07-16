const PROVIDERS = {
	google_gemini: {
		label: 'Gemini',
		methods: ['gemini_api_key_reference', 'gemini_oauth_reference'],
		credentialTypes: ['api_key_reference', 'oauth_refresh_token_reference', 'workload_identity_reference'],
		modelEnv: 'CLOUDMAIL_AI_GEMINI_MODEL_ALIAS',
		referenceEnv: 'CLOUDMAIL_AI_GEMINI_CREDENTIAL_REFERENCE',
		secretEnv: 'CLOUDMAIL_AI_GEMINI_API_KEY'
	},
	openai: {
		label: 'OpenAI / ChatGPT',
		methods: ['openai_project_api_key_reference', 'openai_workload_identity_reference'],
		credentialTypes: ['api_key_reference', 'workload_identity_reference', 'short_lived_access_token_reference'],
		modelEnv: 'CLOUDMAIL_AI_OPENAI_MODEL_ALIAS',
		referenceEnv: 'CLOUDMAIL_AI_OPENAI_CREDENTIAL_REFERENCE',
		secretEnv: 'CLOUDMAIL_AI_OPENAI_API_KEY'
	},
	azure_openai: {
		label: 'Azure OpenAI',
		methods: ['azure_openai_api_key_reference', 'azure_entra_workload_identity_reference'],
		credentialTypes: ['api_key_reference', 'workload_identity_reference'],
		modelEnv: 'CLOUDMAIL_AI_AZURE_OPENAI_DEPLOYMENT_ALIAS',
		referenceEnv: 'CLOUDMAIL_AI_AZURE_OPENAI_CREDENTIAL_REFERENCE',
		secretEnv: 'CLOUDMAIL_AI_AZURE_OPENAI_API_KEY'
	},
	claude: {
		label: 'Claude',
		methods: ['claude_disabled_placeholder'],
		credentialTypes: ['api_key_reference', 'workload_identity_reference'],
		modelEnv: 'CLOUDMAIL_AI_CLAUDE_MODEL_ALIAS',
		referenceEnv: 'CLOUDMAIL_AI_CLAUDE_CREDENTIAL_REFERENCE',
		secretEnv: 'CLOUDMAIL_AI_CLAUDE_API_KEY',
		placeholderOnly: true
	}
};

const SYNTHETIC_TASKS_ALLOWED = ['ping', 'summarize_synthetic', 'draft_synthetic', 'translate_synthetic'];

function bool(value, fallback = false) {
	if (value == null || value === '') return fallback;
	return String(value).toLowerCase() === 'true';
}

function int(value, fallback) {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : fallback;
}

const providerRuntimeConfigLoader = {
	featureFlags(env) {
		return {
			runtimeExperimental: bool(env.CLOUDMAIL_AI_RUNTIME_EXPERIMENTAL, false),
			geminiEnabled: bool(env.CLOUDMAIL_AI_PROVIDER_GEMINI_ENABLED, false),
			openaiEnabled: bool(env.CLOUDMAIL_AI_PROVIDER_OPENAI_ENABLED, false),
			openaiTemporarilyFrozen: bool(env.CLOUDMAIL_AI_PROVIDER_OPENAI_TEMPORARILY_FROZEN, true),
			azureOpenaiEnabled: bool(env.CLOUDMAIL_AI_PROVIDER_AZURE_OPENAI_ENABLED, false),
			claudeEnabled: false,
			syntheticPreflightEnabled: bool(env.CLOUDMAIL_AI_SYNTHETIC_PREFLIGHT_ENABLED, true),
			productionDataAllowed: bool(env.CLOUDMAIL_AI_PRODUCTION_DATA_ALLOWED, false),
			mailboxDataAllowed: bool(env.CLOUDMAIL_AI_MAILBOX_DATA_ALLOWED, false)
		};
	},

	providerDataFlags(env, providerId) {
		const normalized = String(providerId || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_');
		return {
			syntheticAllowed: bool(env[`CLOUDMAIL_AI_PROVIDER_${normalized}_SYNTHETIC_ALLOWED`], true),
			mailboxAllowed: bool(env[`CLOUDMAIL_AI_PROVIDER_${normalized}_MAILBOX_ALLOWED`], false),
			attachmentAllowed: bool(env[`CLOUDMAIL_AI_PROVIDER_${normalized}_ATTACHMENT_ALLOWED`], false),
			contactsAllowed: bool(env[`CLOUDMAIL_AI_PROVIDER_${normalized}_CONTACTS_ALLOWED`], false),
			calendarAllowed: bool(env[`CLOUDMAIL_AI_PROVIDER_${normalized}_CALENDAR_ALLOWED`], false)
		};
	},

	load(env, params = {}) {
		const providerId = String(params.provider_id || params.providerId || '').trim();
		const provider = PROVIDERS[providerId];
		if (!provider) {
			return { ok: false, reason: 'unsupported_provider', flags: this.featureFlags(env) };
		}
		const methodId = String(params.method_id || params.methodId || '').trim();
		if (!provider.methods.includes(methodId)) {
			return { ok: false, reason: 'unsupported_method', flags: this.featureFlags(env), provider_id: providerId };
		}

		const flags = this.featureFlags(env);
		const providerDataFlags = this.providerDataFlags(env, providerId);
		const providerEnabled =
			providerId === 'google_gemini' ? flags.geminiEnabled :
			providerId === 'openai' ? flags.openaiEnabled :
			providerId === 'azure_openai' ? flags.azureOpenaiEnabled :
			providerId === 'claude' ? false : false;
		const credentialReference = env[provider.referenceEnv] || '';
		const modelAlias = params.model_alias || params.modelAlias || env[provider.modelEnv] || '';
		const credentialSecret = env[provider.secretEnv] || '';
		const credentialType = methodId.includes('oauth') ? 'oauth_refresh_token_reference'
			: methodId.includes('workload') || methodId.includes('entra') ? 'workload_identity_reference'
				: 'api_key_reference';
		const usesUserOwnedOAuth = providerId === 'google_gemini' && methodId === 'gemini_oauth_reference';
		const unavailableReason = providerId === 'openai' && flags.openaiTemporarilyFrozen
			? 'CHATGPT_TEMPORARILY_FROZEN'
			: !providerEnabled
			? 'PROVIDER_DISABLED_BY_FEATURE_FLAG'
			: providerId === 'claude'
				? 'CLAUDE_PLACEHOLDER_NOT_CONNECTED'
				: provider.placeholderOnly
					? 'PROVIDER_PLACEHOLDER_ONLY'
					: null;

		return {
			ok: Boolean(!unavailableReason && credentialReference && modelAlias),
			reason: unavailableReason || (!credentialReference ? 'BLOCKED_AI_PROVIDER_CREDENTIAL_REFERENCE_REQUIRED' : !modelAlias ? 'model_alias_missing' : null),
			provider_id: providerId,
			provider_namespace: `ai_provider.${providerId}`,
			provider_label: provider.label,
			method_id: methodId,
			credential_type: credentialType,
			credential_reference: credentialReference,
			secret_boundary: usesUserOwnedOAuth ? 'user_oauth_reference' : `${providerId}_runtime_secret`,
			credential_secret_present: usesUserOwnedOAuth ? true : Boolean(credentialSecret),
			runtime_auth_source: usesUserOwnedOAuth ? 'user_oauth_token' : 'platform_api_key',
			billing_owner: usesUserOwnedOAuth ? 'user' : 'platform',
			provider_ownership: usesUserOwnedOAuth ? 'user_owned' : 'platform_managed',
			shared_platform_api_key: usesUserOwnedOAuth ? false : Boolean(credentialSecret),
			provider_enabled: providerEnabled,
			provider_scaffolded: true,
			provider_configured: Boolean(credentialReference && modelAlias),
			provider_authorized: Boolean(usesUserOwnedOAuth || credentialSecret),
			provider_verified: false,
			production_ready: false,
			model_alias: modelAlias,
			synthetic_tasks_allowed: SYNTHETIC_TASKS_ALLOWED,
			production_mailbox_data_allowed: false,
			mailbox_content_allowed: providerDataFlags.mailboxAllowed === true && flags.mailboxDataAllowed === true,
			attachments_allowed: providerDataFlags.attachmentAllowed === true && flags.mailboxDataAllowed === true,
			contacts_allowed: providerDataFlags.contactsAllowed === true && flags.mailboxDataAllowed === true,
			calendar_allowed: providerDataFlags.calendarAllowed === true && flags.mailboxDataAllowed === true,
			provider_data_flags: providerDataFlags,
			user_visible_status: flags.runtimeExperimental && providerEnabled && credentialReference && modelAlias && (usesUserOwnedOAuth || credentialSecret)
				? 'synthetic_preflight_available'
				: 'not_available',
			environment: env.CLOUDMAIL_AI_RUNTIME_ENVIRONMENT || 'unset',
			timeout_ms: int(env.CLOUDMAIL_AI_TIMEOUT_MS, 15000),
			retry_policy: { max_attempts: int(env.CLOUDMAIL_AI_RETRY_ATTEMPTS, 1) },
			rate_limit: { per_minute: int(env.CLOUDMAIL_AI_RATE_LIMIT_PER_MINUTE, 10) },
			cost_limit: { synthetic_max_units: int(env.CLOUDMAIL_AI_SYNTHETIC_COST_UNITS, 1) },
			redaction_policy: 'metadata_only_redaction_required',
			audit_policy: 'metadata_only_audit_required',
			feature_flag: 'CLOUDMAIL_AI_RUNTIME_EXPERIMENTAL',
			flags
		};
	},

	resolveSecret(env, providerId) {
		const provider = PROVIDERS[providerId];
		return provider ? env[provider.secretEnv] || '' : '';
	}
};

export default providerRuntimeConfigLoader;
