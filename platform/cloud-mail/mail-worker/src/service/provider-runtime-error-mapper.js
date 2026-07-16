import providerRuntimeRedactor from './provider-runtime-redactor';

const providerRuntimeErrorMapper = {
	map(error, fallback = 'AI runtime request failed safely.') {
		const message = providerRuntimeRedactor.redact(error?.message || error || fallback);
		const providerError = error?.provider_error || null;
		return {
			code: error?.code || 'provider_runtime_error',
			message: String(message || fallback).slice(0, 220),
			http_status: error?.status || providerError?.http_status || null,
			provider_error: providerError ? {
				http_status: providerError.http_status || null,
				status: providerError.status || null,
				code: providerError.code || null,
				message: String(providerRuntimeRedactor.redact(providerError.message || '')).slice(0, 500),
				details: Array.isArray(providerError.details) ? providerError.details.slice(0, 4) : []
			} : null
		};
	}
};

export default providerRuntimeErrorMapper;
