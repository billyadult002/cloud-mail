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

const serviceSource = readFileSync(new URL('../src/service/nexora-email-classification-service.mjs', import.meta.url), 'utf8');
const apiSource = readFileSync(new URL('../src/api/nexora-email-classification-api.js', import.meta.url), 'utf8');
for (const forbidden of ['access_token', 'refresh_token', 'pkce_verifier', 'client_secret']) {
	assert.equal(serviceSource.includes(forbidden), false, `service must not persist or reference ${forbidden}`);
}

assert.ok(apiSource.includes('requireAdmin(c);'), 'classification persistence must require admin authority');
assert.ok(apiSource.includes("correctionInput.authorityRef = `user:${user.userId}`"), 'user corrections must bind authority to authenticated user context');
assert.equal(classificationService.CLASSIFIER_VERSION, 'nexora-option5-hybrid-classifier-v1');

console.log('classification contract check passed');
