const MANIFEST_VERSION = 'google-oauth-scopes-v1';

const GOOGLE_SCOPE_MANIFEST = Object.freeze([
	{ scope: 'openid', purpose: 'Bind the Google subject to the authorization session.', capability: 'identity', access: 'read', mailboxContent: false, credentialSensitive: true, deletionAuthority: false, humanApproval: true, productionStatus: 'approved' },
	{ scope: 'email', purpose: 'Bind the verified Google email identity to the canonical account.', capability: 'account_identity', access: 'read', mailboxContent: false, credentialSensitive: true, deletionAuthority: false, humanApproval: true, productionStatus: 'approved' },
	{ scope: 'https://www.googleapis.com/auth/gmail.metadata', purpose: 'Read Gmail labels and message metadata without bodies.', capability: 'mail_metadata', access: 'read', mailboxContent: false, credentialSensitive: true, deletionAuthority: false, humanApproval: true, productionStatus: 'not_approved' },
	{ scope: 'https://www.googleapis.com/auth/gmail.readonly', purpose: 'Read Gmail message content for the mail_read capability.', capability: 'mail_read', access: 'read', mailboxContent: true, credentialSensitive: true, deletionAuthority: false, humanApproval: true, productionStatus: 'approved' },
	{ scope: 'https://www.googleapis.com/auth/gmail.compose', purpose: 'Create drafts without sending or deleting messages.', capability: 'mail_draft', access: 'write', mailboxContent: true, credentialSensitive: true, deletionAuthority: false, humanApproval: true, productionStatus: 'not_approved' },
	{ scope: 'https://www.googleapis.com/auth/gmail.send', purpose: 'Send email as the authorized account.', capability: 'mail_send', access: 'write', mailboxContent: true, credentialSensitive: true, deletionAuthority: false, humanApproval: true, productionStatus: 'not_approved' },
	{ scope: 'https://www.googleapis.com/auth/gmail.modify', purpose: 'Read and modify mailbox labels and message state.', capability: 'mail_modify', access: 'write', mailboxContent: true, credentialSensitive: true, deletionAuthority: false, humanApproval: true, productionStatus: 'not_approved' },
	{ scope: 'https://mail.google.com/', purpose: 'Full Gmail authority including permanent deletion.', capability: 'mail_full_control', access: 'write', mailboxContent: true, credentialSensitive: true, deletionAuthority: true, humanApproval: true, productionStatus: 'prohibited' },
]);

const APPROVED_CAPABILITY_SCOPES = Object.freeze({
	mail_read: Object.freeze(['openid', 'email', 'https://www.googleapis.com/auth/gmail.readonly']),
});

async function digest(value) {
	const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
	return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function canonicalScopes(scopes) {
	return [...new Set((scopes || []).map(String))].sort();
}

async function verifyRequestedScopes({ provider, capabilities, requestedScopes }) {
	if (provider !== 'google') {
		const expectedScopes = canonicalScopes(requestedScopes);
		const manifestVersion = `${provider}-oauth-scopes-compat-v1`;
		return {
			approved: true,
			reason: null,
			manifestVersion,
			manifestDigest: await digest({ version: manifestVersion, provider, capabilities: canonicalScopes(capabilities), scopes: expectedScopes }),
			expectedScopes,
			summary: expectedScopes.map((scope) => ({ scope, purpose: 'Existing provider capability contract.', access: 'provider_defined', mailboxContent: true, humanApproval: true })),
		};
	}
	const requestedCapabilities = [...new Set((capabilities || []).map(String))].sort();
	if (requestedCapabilities.length !== 1 || requestedCapabilities[0] !== 'mail_read') {
		return { approved: false, reason: 'SCOPE_MANIFEST_CAPABILITY_NOT_APPROVED', manifestVersion: MANIFEST_VERSION };
	}
	const expected = canonicalScopes(APPROVED_CAPABILITY_SCOPES.mail_read);
	const requested = canonicalScopes(requestedScopes);
	const unknown = requested.filter((scope) => !GOOGLE_SCOPE_MANIFEST.some((entry) => entry.scope === scope));
	const unexpected = requested.filter((scope) => !expected.includes(scope));
	const missing = expected.filter((scope) => !requested.includes(scope));
	const prohibited = requested.filter((scope) => GOOGLE_SCOPE_MANIFEST.find((entry) => entry.scope === scope)?.productionStatus !== 'approved');
	const manifestDigest = await digest({ version: MANIFEST_VERSION, provider, capabilities: requestedCapabilities, scopes: expected });
	const approved = !unknown.length && !unexpected.length && !missing.length && !prohibited.length;
	return {
		approved,
		reason: approved ? null : 'SCOPE_MANIFEST_MISMATCH',
		manifestVersion: MANIFEST_VERSION,
		manifestDigest,
		expectedScopes: expected,
		unknownScopes: unknown,
		unexpectedScopes: unexpected,
		missingScopes: missing,
		prohibitedScopes: prohibited,
		summary: expected.map((scope) => {
			const entry = GOOGLE_SCOPE_MANIFEST.find((candidate) => candidate.scope === scope);
			return { scope: entry.scope, purpose: entry.purpose, access: entry.access, mailboxContent: entry.mailboxContent, humanApproval: entry.humanApproval };
		}),
	};
}

async function verifyGrantedScopes({ manifestVersion, manifestDigest, provider, capabilities, requestedScopes, grantedScopes }) {
	const requested = await verifyRequestedScopes({ provider, capabilities, requestedScopes });
	if (!requested.approved || manifestVersion !== requested.manifestVersion || manifestDigest !== requested.manifestDigest) {
		return { approved: false, reason: 'SCOPE_MANIFEST_BINDING_MISMATCH' };
	}
	const granted = canonicalScopes(grantedScopes);
	if (granted.length !== requested.expectedScopes.length || granted.some((scope, index) => scope !== requested.expectedScopes[index])) {
		return { approved: false, reason: 'POST_AUTHORIZATION_SCOPE_SUBSTITUTION', unexpectedScopes: granted.filter((scope) => !requested.expectedScopes.includes(scope)), missingScopes: requested.expectedScopes.filter((scope) => !granted.includes(scope)) };
	}
	return { approved: true, manifestVersion, manifestDigest };
}

export { MANIFEST_VERSION, GOOGLE_SCOPE_MANIFEST, verifyRequestedScopes, verifyGrantedScopes };
export default { MANIFEST_VERSION, GOOGLE_SCOPE_MANIFEST, verifyRequestedScopes, verifyGrantedScopes };
