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

async function keyFor(c) {
	const secret = c.env.AI_PROVIDER_TOKEN_SECRET || c.env.PROVIDER_TOKEN_SECRET || c.env.GMAIL_CREDENTIAL_SECRET || c.env.jwt_secret || c.env.JWT_SECRET;
	if (!secret || String(secret).length < 16) {
		throw new Error('Provider token encryption secret is not configured.');
	}
	const digest = await crypto.subtle.digest('SHA-256', encoder.encode(secret));
	return crypto.subtle.importKey('raw', digest, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(c, value) {
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const key = await keyFor(c);
	const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(String(value || '')));
	return `${base64Encode(iv)}.${base64Encode(new Uint8Array(cipher))}`;
}

export async function decryptSecret(c, value) {
	const [ivRaw, cipherRaw] = String(value || '').split('.');
	if (!ivRaw || !cipherRaw) throw new Error('Stored provider token is invalid.');
	const key = await keyFor(c);
	const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: base64Decode(ivRaw) }, key, base64Decode(cipherRaw));
	return decoder.decode(plain);
}
