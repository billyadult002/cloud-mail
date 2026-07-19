import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import classificationService, { classifyMessage } from '../src/service/nexora-email-classification-service.mjs';

const promotional = classifyMessage({
	provider: 'google',
	providerAccountHash: 'acct-hash',
	customerDomain: 'customer.example',
	messageId: 'promo-1',
	sender: 'retail@example.net',
	subject: 'VIP sale: 50% off today only',
	headers: {
		'List-Unsubscribe': '<mailto:unsubscribe@example.net>',
		'List-ID': 'deals.example.net',
		'Feedback-ID': 'campaign:retail'
	},
	providerLabels: ['CATEGORY_PROMOTIONS'],
	recipientCount: 250,
	linkCount: 12,
	trackingLinkCount: 9,
	receivedFromSenderCount: 10,
	sentToSenderCount: 0,
	humanReplyCount: 0,
	verifiedEnterpriseDirectoryRoleRef: 'directory:executive'
});

assert.equal(promotional.primaryCategory, 'PROMOTION');
assert.equal(promotional.vipRelationship, false);
assert.equal(promotional.vipAuthorityRef, null);
assert.ok(promotional.reasonCodes.includes('VIP_AUTOMATIC_DISQUALIFIED_BULK_OR_PROMOTION'));
assert.ok(promotional.reasonCodes.includes('MARKETING_URGENCY_NOT_ACTION_AUTHORITY'));

const explicitVipPromotion = classifyMessage({
	provider: 'google',
	providerAccountHash: 'acct-hash',
	customerDomain: 'customer.example',
	messageId: 'promo-2',
	sender: 'retail@example.net',
	subject: 'Sale for account owners',
	headers: { 'List-Unsubscribe': '<mailto:unsubscribe@example.net>' },
	providerLabels: ['CATEGORY_PROMOTIONS'],
	explicitUserVipRef: 'user-correction:vip:123'
});

assert.equal(explicitVipPromotion.primaryCategory, 'PROMOTION');
assert.equal(explicitVipPromotion.vipRelationship, true);
assert.equal(explicitVipPromotion.vipAuthorityRef, 'user-correction:vip:123');

const actionRequired = classifyMessage({
	provider: 'microsoft',
	providerAccountHash: 'acct-hash',
	customerDomain: 'customer.example',
	messageId: 'action-1',
	sender: 'partner@example.org',
	subject: 'Signature required by Friday',
	snippet: 'Please reply and sign the attached amendment before the deadline.',
	humanReplyCount: 3,
	sentToSenderCount: 4,
	receivedFromSenderCount: 5,
	verifiedPartnerKeyContactRef: 'partner-contact:456',
	hasAttachment: true
});

assert.equal(actionRequired.vipRelationship, true);
assert.equal(actionRequired.requiresAction, true);
assert.equal(actionRequired.priorityLevel, 'NONE');
assert.equal(actionRequired.primaryCategory, 'PERSONAL');

const corrected = classifyMessage({
	provider: 'google',
	providerAccountHash: 'acct-hash',
	customerDomain: 'customer.example',
	messageId: 'correction-1',
	sender: 'alerts@example.net',
	subject: 'Security alert'
}, [{
	correctionType: 'MARK_NOTIFICATION',
	authoritySource: 'USER',
	authorityRef: 'user-correction:notification:1'
}, {
	correctionType: 'MOVE_TO_VIP',
	authoritySource: 'ADMIN',
	authorityRef: 'admin-policy:vip:1'
}]);

assert.equal(corrected.primaryCategory, 'NOTIFICATION');
assert.equal(corrected.vipRelationship, true);
assert.equal(corrected.vipAuthorityRef, 'admin-policy:vip:1');

const newsletter = classifyMessage({
	provider: 'google',
	providerAccountHash: 'acct-hash',
	customerDomain: 'customer.example',
	messageId: 'newsletter-1',
	sender: 'digest@example.net',
	subject: 'Weekly product digest',
	headers: {
		'List-ID': 'weekly.example.net',
		'Precedence': 'list'
	},
	humanReplyCount: 0,
	receivedFromSenderCount: 7
});

assert.equal(newsletter.primaryCategory, 'NEWSLETTER');
assert.equal(newsletter.vipRelationship, false);

const social = classifyMessage({
	provider: 'google',
	providerAccountHash: 'acct-hash',
	customerDomain: 'customer.example',
	messageId: 'social-1',
	sender: 'notify@social.example',
	subject: 'A colleague mentioned you',
	snippet: 'Mina mentioned you in a comment.',
	providerLabels: ['CATEGORY_SOCIAL']
});

assert.equal(social.primaryCategory, 'SOCIAL');
assert.equal(social.vipRelationship, false);

const invoice = classifyMessage({
	provider: 'microsoft',
	providerAccountHash: 'acct-hash',
	customerDomain: 'customer.example',
	messageId: 'invoice-1',
	sender: 'billing@vendor.example',
	subject: 'Invoice payment required',
	snippet: 'Payment required by Friday for invoice 1234.'
});

assert.equal(invoice.primaryCategory, 'TRANSACTIONAL');
assert.equal(invoice.requiresAction, true);

const urgentPromotion = classifyMessage({
	provider: 'google',
	providerAccountHash: 'acct-hash',
	customerDomain: 'customer.example',
	messageId: 'urgent-promo-1',
	sender: 'deals@example.net',
	subject: 'Action required: sale ends tonight',
	headers: { 'List-Unsubscribe': '<mailto:unsubscribe@example.net>' },
	providerLabels: ['CATEGORY_PROMOTIONS']
});

assert.equal(urgentPromotion.primaryCategory, 'PROMOTION');
assert.equal(urgentPromotion.requiresAction, false);
assert.equal(urgentPromotion.priorityLevel, 'NONE');

const ambiguous = classifyMessage({
	provider: 'imap',
	providerAccountHash: 'acct-hash',
	customerDomain: 'customer.example',
	messageId: 'ambiguous-1',
	sender: 'unknown@example.net',
	subject: 'Hello'
});

assert.equal(ambiguous.primaryCategory, 'UNCLASSIFIED');
assert.equal(ambiguous.vipRelationship, false);
assert.equal(ambiguous.priorityLevel, 'NONE');
assert.equal(ambiguous.requiresAction, false);

const bulkPersonalDisplayName = classifyMessage({
	provider: 'google',
	providerAccountHash: 'acct-hash',
	customerDomain: 'customer.example',
	messageId: 'bulk-personal-1',
	sender: 'ceo-name@campaign.example',
	subject: 'Personal offer just for you',
	headers: {
		'List-Unsubscribe': '<mailto:unsubscribe@campaign.example>',
		'Feedback-ID': 'campaign:personalized'
	},
	recipientCount: 500,
	humanReplyCount: 0,
	verifiedCustomerKeyContactRef: 'customer-contact:false-positive'
});

assert.equal(bulkPersonalDisplayName.vipRelationship, false);

assert.notEqual(
	classificationService.buildMessageFingerprint({ provider: 'google', providerAccountHash: 'acct-a', messageId: 'same', customerDomain: 'a.example' }),
	classificationService.buildMessageFingerprint({ provider: 'google', providerAccountHash: 'acct-b', messageId: 'same', customerDomain: 'b.example' })
);

const serviceSource = readFileSync(new URL('../src/service/nexora-email-classification-service.mjs', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../src/api/nexora-email-classification-api.js', import.meta.url), 'utf8');
const migrationSource = readFileSync(new URL('../migrations/0077_nexora_evidence_first_hybrid_classification.sql', import.meta.url), 'utf8');
for (const forbidden of ['access_token', 'refresh_token', 'pkce_verifier', 'client_secret']) {
	assert.equal(serviceSource.includes(forbidden), false, `service must not persist or reference ${forbidden}`);
}

assert.ok(apiSource.includes('requireAdmin(c);'), 'classification persistence must require admin authority');
assert.ok(apiSource.includes("correctionInput.authorityRef = `user:${user.userId}`"), 'user corrections must bind authority to authenticated user context');
assert.ok(apiSource.includes('cross-tenant classification authority denied'), 'non-admin corrections must fail closed across tenants');
assert.ok(apiSource.includes('workspace classification authority denied'), 'non-admin corrections must require workspace membership');
assert.ok(serviceSource.includes('verified Domain authority is required'), 'durable classification must require verified Domain authority');
assert.ok(migrationSource.includes('UNIQUE(tenant_id,workspace_id,customer_domain,provider,provider_account_hash,message_fingerprint)'), 'message identity must be domain scoped');
assert.equal(classificationService.CLASSIFIER_VERSION, 'nexora-option5-hybrid-classifier-v1');

console.log('classification contract check passed');
