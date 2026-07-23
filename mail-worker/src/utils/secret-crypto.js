const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64Encode(bytes) {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary);
}

function base64Decode(value) {
	const binary = atob(value);
	return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

async function keyFor(c, purpose = 'legacy') {
	const strictProviderKey = purpose === 'provider-token';
	const secret = strictProviderKey
		? (c.env.AI_PROVIDER_TOKEN_SECRET || c.env.PROVIDER_TOKEN_SECRET)
		: (c.env.AI_PROVIDER_TOKEN_SECRET || c.env.PROVIDER_TOKEN_SECRET || c.env.GMAIL_CREDENTIAL_SECRET || c.env.jwt_secret || c.env.JWT_SECRET);
	if (!secret || String(secret).length < 16) {
		throw new Error('Provider token encryption secret is not configured.');
	}
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
	return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(c, value, { purpose = 'legacy', aad = null } = {}) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await keyFor(c, purpose);
	const algorithm = { name: 'AES-GCM', iv, ...(aad ? { additionalData: encoder.encode(aad) } : {}) };
	const cipher = await crypto.subtle.encrypt(algorithm, key, encoder.encode(String(value || '')));
	return aad ? `v2.${base64Encode(iv)}.${base64Encode(new Uint8Array(cipher))}` : `${base64Encode(iv)}.${base64Encode(new Uint8Array(cipher))}`;
}

export async function decryptSecret(c, value, { purpose = 'legacy', aad = null } = {}) {
	const parts = String(value || '').split('.');
	const versioned = parts[0] === 'v2';
	if (versioned && !aad) throw new Error('Stored provider token authority is incomplete.');
	if (!versioned && aad && String(c.env.NEXORA_CONNECTION_RUNTIME_ENABLED || 'false').toLowerCase() === 'true') throw new Error('Legacy provider token requires reauthorization.');
	const [ivRaw, cipherRaw] = versioned ? parts.slice(1) : parts;
	if (!ivRaw || !cipherRaw) throw new Error('Stored provider token is invalid.');
	const key = await keyFor(c, purpose);
	const algorithm = { name: 'AES-GCM', iv: base64Decode(ivRaw), ...(versioned ? { additionalData: encoder.encode(aad) } : {}) };
	const plain = await crypto.subtle.decrypt(algorithm, key, base64Decode(cipherRaw));
	return decoder.decode(plain);
}
