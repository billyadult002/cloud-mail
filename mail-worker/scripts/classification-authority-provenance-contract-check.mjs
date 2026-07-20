import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
	loadCanonicalClassificationContext,
	parseCanonicalMessageId,
	validateLegacyPersistPayload
} from '../src/service/nexora-email-classification-service.mjs';
import { deriveSessionRef } from '../src/service/nexora-session-ref-service.mjs';

const authHeader = 'test-classification-authorization';
const acceptanceEnv = {
	NEXORA_CORRELATION_HASH_SECRET: 'test-only-classification-continuity-secret',
	NEXORA_CORRELATION_HMAC_KEY_VERSION: 'test-v1',
	CF_VERSION_METADATA: { id: 'deployment-ref' },
	NEXORA_ACCEPTANCE_BUILDS_JSON: JSON.stringify([{
		platform: 'DESKTOP', buildId: 'desktop-commit', buildVersion: '3.03',
		artifactDigest: 'a'.repeat(64), sourceCommit: 'b'.repeat(40),
		signingIdentity: 'reviewed-web-release', signingKeyVersion: 'sign-v1', policyVersion: 'policy-v1',
		validFrom: '2020-01-01T00:00:00.000Z', validUntil: '2999-01-01T00:00:00.000Z'
	}])
};

assert.equal(parseCanonicalMessageId(42), 42);
assert.equal(parseCanonicalMessageId('42'), 42);
assert.throws(() => parseCanonicalMessageId('provider-message-42'), /canonicalMessageId/);
assert.throws(() => parseCanonicalMessageId(0), /canonicalMessageId/);

assert.doesNotThrow(() => validateLegacyPersistPayload({ interactionId: 'interaction-1', canonicalMessageId: 42 }));
assert.throws(
	() => validateLegacyPersistPayload({ interactionId: 'interaction-1', canonicalMessageId: 42, tenantId: 999 }),
	/tenantId is server-derived/
);
assert.throws(
	() => validateLegacyPersistPayload({ interactionId: 'interaction-1', canonicalMessageId: 42, message: { subject: 'forged' } }),
	/client-supplied message payload is not accepted/
);

const canonicalRow = {
	interaction_id: 'interaction-1',
	tenant_id: 7,
	workspace_id: 9,
	actor_user_id: 7,
	canonical_account_id: 12,
	auth_session_ref: await deriveSessionRef(acceptanceEnv, authHeader),
	hmac_key_version: 'test-v1',
	request_id: 'request-ref',
	runtime_deployment_id: 'deployment-ref',
	acceptance_correlation_ref: 'acceptance-ref',
	client_kind: 'DESKTOP',
	build_id: 'desktop-commit',
	build_version: '3.03',
	artifact_digest: 'a'.repeat(64),
	source_commit: 'b'.repeat(40),
	signing_identity: 'reviewed-web-release',
	signing_key_version: 'sign-v1',
	allowlist_policy_version: 'policy-v1',
	interaction_status: 'ISSUED',
	interaction_expires_at: '2999-01-01T00:00:00.000Z',
	email_id: 42,
	email_account_id: 12,
	email_user_id: 7,
	send_email: 'sender@outside.example',
	subject: 'Invoice payment required',
	text: 'Payment required by Friday.',
	content: '<p>must never be returned</p>',
	message_id: 'provider-message-42',
	resend_email_id: null,
	relation: '',
	in_reply_to: '',
	unread: 1,
	source_created_at: '2026-07-19T10:00:00.000Z',
	account_id: 12,
	account_user_id: 7,
	account_email: 'owner@verified.example',
	account_domain: 'verified.example',
	provider: 'google',
	sync_status: 'mailbox_ready',
	has_attachment: 0,
	starred: 0
	,domain_authority_id: 'authority-1'
	,authority_generation: 2
	,authority_evidence_ref: 'authority-evidence-1'
};

function fakeContext(row = canonicalRow) {
	const binds = [];
	return {
		binds,
		context: {
			req: { header: (name) => name.toLowerCase() === 'authorization' ? authHeader : null },
			env: {
				...acceptanceEnv,
				db: {
					prepare(sql) {
						return {
							bind(...values) {
								binds.push({ sql, values });
								return { first: async () => row };
							}
						};
					}
				}
			}
		}
	};
}

const success = fakeContext();
const canonical = await loadCanonicalClassificationContext(success.context, {
	interactionId: 'interaction-1',
	canonicalMessageId: 42,
	actor: { userId: 7 }
});
assert.equal(canonical.scope.tenantId, 7);
assert.equal(canonical.scope.workspaceId, 9);
assert.equal(canonical.message.customerDomain, 'verified.example');
assert.equal(canonical.message.provider, 'google');
assert.equal(canonical.message.canonicalAccountId, 12);
assert.equal(canonical.message.canonicalMessageId, 42);
assert.equal(canonical.provenance.source, 'CANONICAL_EMAIL');
assert.equal(Object.hasOwn(canonical.provenance, 'text'), false);
assert.equal(Object.hasOwn(canonical.provenance, 'content'), false);
assert.deepEqual(success.binds[0].values, ['interaction-1', 7, 42]);
assert.match(success.binds[0].sql, /workspace_account_bindings/);
assert.match(success.binds[0].sql, /workspace_members/);
assert.match(success.binds[0].sql, /e\.is_del=0/);
assert.match(success.binds[0].sql, /a\.is_del=0/);

await assert.rejects(
	() => loadCanonicalClassificationContext(fakeContext({ ...canonicalRow, canonical_account_id: 99 }).context, {
		interactionId: 'interaction-1', canonicalMessageId: 42, actor: { userId: 7 }
	}),
	/interaction account does not match canonical message/
);
await assert.rejects(
	() => loadCanonicalClassificationContext(fakeContext({ ...canonicalRow, interaction_status: 'EXPIRED' }).context, {
		interactionId: 'interaction-1', canonicalMessageId: 42, actor: { userId: 7 }
	}),
	/classification interaction is not active/
);
await assert.rejects(
	() => loadCanonicalClassificationContext(fakeContext(null).context, {
		interactionId: 'interaction-1', canonicalMessageId: 42, actor: { userId: 7 }
	}),
	/canonical classification context is not authorized/
);

const apiSource = readFileSync(new URL('../src/api/nexora-email-classification-api.js', import.meta.url), 'utf8');
const serviceSource = readFileSync(new URL('../src/service/nexora-email-classification-service.mjs', import.meta.url), 'utf8');
assert.match(apiSource, /body\.interactionId/);
assert.match(apiSource, /body\.canonicalMessageId/);
assert.match(apiSource, /\/v3\/classification\/records\/:canonicalMessageId/);
assert.doesNotMatch(apiSource, /scopeFromBody/);
assert.match(serviceSource, /buildAtomicLedgerStatements/);
assert.match(serviceSource, /computeEvidenceIntegrity/);
assert.match(serviceSource, /verifyEvidenceChain/);
assert.doesNotMatch(serviceSource, /readEvidenceChain/);
assert.match(serviceSource, /classification ledger atomic commit rejected/);
assert.doesNotMatch(serviceSource, /INSERT INTO nexora_email_classification_evidence\s/);

console.log('classification authority/provenance contract check passed');
