const encoder = new TextEncoder();

function bytesToHex(bytes) {
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function correlationHmacConfig(env) {
	const secret = String(env?.NEXORA_CORRELATION_HASH_SECRET || '');
	const keyVersion = String(env?.NEXORA_CORRELATION_HMAC_KEY_VERSION || '');
	if (!secret) throw new Error('NEXORA correlation HMAC secret is not configured');
	if (encoder.encode(secret).byteLength < 32) throw new Error('NEXORA correlation HMAC secret must be at least 32 bytes');
	if (!keyVersion) throw new Error('NEXORA correlation HMAC key version is not configured');
	return { secret, keyVersion };
}

export async function deriveCorrelationRef(env, context, value) {
	const domain = String(context || '').trim();
	const material = String(value || '');
	if (!domain) throw new Error('correlation HMAC context is required');
	if (!material) throw new Error('correlation HMAC material is required');
	const { secret, keyVersion } = correlationHmacConfig(env);
	const key = await crypto.subtle.importKey(
		'raw',
		encoder.encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const payload = `nexora-correlation-hmac-v1\n${keyVersion}\n${domain}\n${material}`;
	return bytesToHex(await crypto.subtle.sign('HMAC', key, encoder.encode(payload)));
}

export async function deriveSessionRef(env, authorization) {
	if (!authorization) throw new Error('authenticated session reference is required');
	return deriveCorrelationRef(env, 'auth-session', authorization);
}

export default { deriveCorrelationRef, deriveSessionRef };
