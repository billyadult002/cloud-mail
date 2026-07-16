import { decryptSecret } from '../utils/secret-crypto';

export const CapabilityStatus = {
	PASS: 'PASS',
	WARN: 'WARN',
	FAIL: 'FAIL',
	UNKNOWN: 'UNKNOWN'
};

const OAUTH_CREDENTIAL_PREFIX = 'oauth-json:';

function isOAuthCredential(ciphertext) {
	return String(ciphertext || '').startsWith(OAUTH_CREDENTIAL_PREFIX);
}

export async function resolveCapabilities(c, userId, accountId) {
	const defaultResult = {
		canLogin: CapabilityStatus.UNKNOWN,
		canSend: CapabilityStatus.UNKNOWN,
		canReceive: CapabilityStatus.UNKNOWN,
		canSync: CapabilityStatus.UNKNOWN,
		canImport: CapabilityStatus.UNKNOWN,
		canRoute: CapabilityStatus.UNKNOWN,
		canAIProcess: CapabilityStatus.UNKNOWN
	};

	try {
		const account = await c.env.db.prepare(
			`SELECT * FROM account WHERE user_id = ?1 AND account_id = ?2 AND is_del = 0 LIMIT 1`
		).bind(userId, accountId).first();
		if (!account) return defaultResult;

		const credential = await c.env.db.prepare(
			`SELECT * FROM mail_provider_credentials WHERE user_id = ?1 AND account_id = ?2 LIMIT 1`
		).bind(userId, accountId).first();

		let loginStatus = CapabilityStatus.UNKNOWN;
		let sendStatus = CapabilityStatus.UNKNOWN;
		let receiveStatus = CapabilityStatus.UNKNOWN;
		let syncStatusVal = CapabilityStatus.UNKNOWN;
		let importStatus = CapabilityStatus.UNKNOWN;

		const hasCred = !!credential?.credential_ciphertext;
		const rawStatus = String(account.sync_status || '').toLowerCase();
		const terminalAuthorizationState = rawStatus === 'needs_reconnect' || rawStatus === 'legacy_imap_unsupported';
		let oauthScopeHasSend = false;
		let oauthScopeHasRead = false;
		if (credential && isOAuthCredential(credential.credential_ciphertext)) {
			try {
				const encrypted = String(credential.credential_ciphertext).slice(OAUTH_CREDENTIAL_PREFIX.length);
				const payload = JSON.parse(await decryptSecret(c, encrypted));
				const scope = String(payload.scope || '');
				oauthScopeHasSend = scope.includes('gmail.send') || scope.includes('gmail.compose') || scope.includes('mail.google.com');
				oauthScopeHasRead = scope.includes('gmail.readonly') || scope.includes('gmail.modify') || scope.includes('mail.google.com');
			} catch {
				// An unreadable credential remains unknown; do not claim send capability.
			}
		}

		// 1. CanLogin evaluation
		if (hasCred) {
			if (terminalAuthorizationState) {
				loginStatus = CapabilityStatus.FAIL;
			} else if (oauthScopeHasRead || rawStatus === 'sync_required' || rawStatus === 'mailbox_ready' || rawStatus === 'first_import_pending' || rawStatus === 'import_in_progress') {
				loginStatus = CapabilityStatus.PASS;
			} else {
				loginStatus = CapabilityStatus.WARN;
			}
		} else {
			loginStatus = CapabilityStatus.FAIL;
		}

		// 2. CanSend & CanReceive & CanSync evaluation
		if (loginStatus === CapabilityStatus.PASS) {
			syncStatusVal = CapabilityStatus.PASS;
			receiveStatus = CapabilityStatus.PASS;

			if (credential && isOAuthCredential(credential.credential_ciphertext)) {
				sendStatus = oauthScopeHasSend ? CapabilityStatus.PASS : CapabilityStatus.FAIL;
			} else {
				// Legacy IMAP accounts cannot send via OAuth REST
				sendStatus = CapabilityStatus.FAIL;
			}
		} else if (loginStatus === CapabilityStatus.FAIL) {
			syncStatusVal = CapabilityStatus.FAIL;
			receiveStatus = CapabilityStatus.FAIL;
			sendStatus = CapabilityStatus.FAIL;
		} else {
			syncStatusVal = CapabilityStatus.WARN;
			receiveStatus = CapabilityStatus.WARN;
			sendStatus = CapabilityStatus.WARN;
		}

		// Sending is governed by the current, readable OAuth credential and its
		// granted send scope. It is deliberately independent from a recoverable
		// receive-content page gap; only a terminal authorization state can revoke it.
		if (!terminalAuthorizationState && oauthScopeHasSend) {
			sendStatus = CapabilityStatus.PASS;
		}

		// 3. CanImport evaluation
		if (account.backfill_done === 1) {
			importStatus = CapabilityStatus.PASS;
		} else if (String(account.sync_status || '').toLowerCase() === 'first_import_failed') {
			importStatus = CapabilityStatus.FAIL;
		} else if (loginStatus === CapabilityStatus.PASS) {
			importStatus = CapabilityStatus.WARN; // in progress
		} else {
			importStatus = CapabilityStatus.FAIL;
		}

		// 4. CanRoute evaluation
		const domain = String(account.domain || '').toLowerCase();
		const isManagedDomain = domain !== 'gmail.com' && domain !== 'googlemail.com';
		const routeStatus = isManagedDomain ? CapabilityStatus.PASS : CapabilityStatus.WARN;

		// 5. CanAIProcess evaluation
		const aiStatus = (loginStatus === CapabilityStatus.PASS && account.backfill_done === 1)
			? CapabilityStatus.PASS
			: CapabilityStatus.WARN;

		return {
			canLogin: loginStatus,
			canSend: sendStatus,
			canReceive: receiveStatus,
			canSync: syncStatusVal,
			canImport: importStatus,
			canRoute: routeStatus,
			canAIProcess: aiStatus
		};
	} catch {
		return defaultResult;
	}
}
