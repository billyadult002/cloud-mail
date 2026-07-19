export const CLASSIFIER_VERSION = 'nexora-option5-hybrid-classifier-v1';
export const RULES_VERSION = 'option5-deterministic-rules-v1';
export const MODEL_VERSION = null;

export const SEMANTIC_CATEGORIES = Object.freeze([
	'PERSONAL',
	'BUSINESS',
	'TRANSACTIONAL',
	'NOTIFICATION',
	'NEWSLETTER',
	'PROMOTION',
	'SOCIAL',
	'SPAM',
	'SUSPICIOUS',
	'UNCLASSIFIED'
]);

const CORRECTION_CATEGORY = Object.freeze({
	MARK_TRANSACTIONAL: 'TRANSACTIONAL',
	MARK_NOTIFICATION: 'NOTIFICATION',
	MARK_NEWSLETTER: 'NEWSLETTER',
	MARK_PROMOTION: 'PROMOTION',
	MARK_SOCIAL: 'SOCIAL',
	MARK_SPAM: 'SPAM',
	MARK_NOT_SPAM: 'UNCLASSIFIED'
});

const PROVIDER_PROMOTION_LABELS = new Set(['category_promotions', 'promotions', 'promotion', 'marketing']);
const PROVIDER_SOCIAL_LABELS = new Set(['category_social', 'social']);
const PROVIDER_NOTIFICATION_LABELS = new Set(['category_updates', 'updates', 'notification', 'notifications']);
const PROVIDER_FORUM_LABELS = new Set(['category_forums', 'forums']);
const PROVIDER_SPAM_LABELS = new Set(['spam', 'junk']);

function normalizeLower(value) {
	return String(value || '').trim().toLowerCase();
}

function normalizeHeaderMap(headers = {}) {
	const normalized = {};
	for (const [key, value] of Object.entries(headers || {})) {
		normalized[normalizeLower(key)] = Array.isArray(value) ? value.join(', ') : String(value ?? '');
	}
	return normalized;
}

function hasHeader(headers, name) {
	return normalizeLower(headers[name]) !== '';
}

function includesAny(text, patterns) {
	const lower = normalizeLower(text);
	return patterns.some((pattern) => lower.includes(pattern));
}

function countMatches(text, patterns) {
	const lower = normalizeLower(text);
	return patterns.reduce((total, pattern) => total + (lower.includes(pattern) ? 1 : 0), 0);
}

function parseJsonArray(value) {
	if (Array.isArray(value)) return value;
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? parsed : [];
	} catch {
		return [];
	}
}

export function stableFingerprint(parts) {
	let first = 0x811c9dc5;
	let second = 0x9e3779b9;
	for (const part of parts) {
		const text = `${String(part ?? '')}\n`;
		for (let index = 0; index < text.length; index += 1) {
			const code = text.charCodeAt(index);
			first ^= code;
			first = Math.imul(first, 0x01000193) >>> 0;
			second ^= code + index;
			second = Math.imul(second, 0x85ebca6b) >>> 0;
		}
	}
	return `${first.toString(16).padStart(8, '0')}${second.toString(16).padStart(8, '0')}`;
}

export function normalizeDomain(domain) {
	return normalizeLower(domain).replace(/^@+/, '');
}

export function normalizeAddress(address) {
	return normalizeLower(address);
}

export function buildMessageFingerprint(input = {}) {
	return stableFingerprint([
		input.provider,
		input.providerAccountHash,
		input.customerDomain || input.domain,
		input.messageId,
		input.sender,
		input.subject,
		input.receivedAt,
		input.threadId
	]);
}

function collectSignals(input = {}) {
	const headers = normalizeHeaderMap(input.headers);
	const labels = new Set((input.providerLabels || []).map(normalizeLower));
	const subject = input.subject || '';
	const snippet = input.snippet || input.text || '';
	const combined = `${subject}\n${snippet}`;
	const recipientCount = Number(input.recipientCount || 0);
	const linkCount = Number(input.linkCount || 0);
	const trackingLinkCount = Number(input.trackingLinkCount || 0);
	const humanReplyCount = Number(input.humanReplyCount || 0);
	const sentToSenderCount = Number(input.sentToSenderCount || 0);
	const receivedFromSenderCount = Number(input.receivedFromSenderCount || 0);

	const reasonCodes = [];
	const conflictingSignals = [];
	const add = (condition, code) => {
		if (condition) reasonCodes.push(code);
		return condition;
	};

	const listSignals = [
		add(hasHeader(headers, 'list-unsubscribe'), 'HEADER_LIST_UNSUBSCRIBE'),
		add(hasHeader(headers, 'list-unsubscribe-post'), 'HEADER_LIST_UNSUBSCRIBE_POST'),
		add(hasHeader(headers, 'list-id'), 'HEADER_LIST_ID'),
		add(includesAny(headers.precedence, ['bulk', 'list', 'junk']), 'HEADER_PRECEDENCE_BULK'),
		add(hasHeader(headers, 'feedback-id'), 'HEADER_FEEDBACK_ID')
	].filter(Boolean).length;

	const autoSignals = [
		add(includesAny(headers['auto-submitted'], ['auto-generated', 'auto-replied']), 'HEADER_AUTO_SUBMITTED'),
		add(hasHeader(headers, 'x-auto-response-suppress'), 'HEADER_AUTO_RESPONSE_SUPPRESS'),
		add(includesAny(headers['return-path'], ['bounce', 'mailer-daemon']), 'HEADER_RETURN_PATH_AUTOMATED')
	].filter(Boolean).length;

	const promoWordCount = countMatches(combined, [
		'sale', 'clearance', 'discount', 'coupon', 'promo code', 'limited time',
		'free shipping', '% off', 'deal', 'shop now', 'unsubscribe'
	]);
	if (promoWordCount > 0) reasonCodes.push('CONTENT_COMMERCIAL_PROMOTION');

	const transactionWordCount = countMatches(combined, [
		'order', 'receipt', 'invoice', 'payment received', 'payment due',
		'shipped', 'tracking number', 'delivery', 'statement'
	]);
	if (transactionWordCount > 0) reasonCodes.push('CONTENT_TRANSACTIONAL');

	const actionWordCount = countMatches(combined, [
		'please reply', 'approval required', 'signature required', 'sign the',
		'payment required', 'submit by', 'deadline', 'action required',
		'meeting response', 'rsvp'
	]);
	if (actionWordCount > 0) reasonCodes.push('CONTENT_ACTION_REQUEST');

	const securityWordCount = countMatches(combined, [
		'security alert', 'password reset', 'new sign-in', 'suspicious login',
		'verify your account', 'mfa', 'two-factor'
	]);
	if (securityWordCount > 0) reasonCodes.push('CONTENT_SECURITY_EVENT');

	const socialWordCount = countMatches(combined, ['liked your', 'commented on', 'mentioned you', 'new follower', 'connection request']);
	if (socialWordCount > 0) reasonCodes.push('CONTENT_SOCIAL_NOTIFICATION');

	const providerPromotion = [...labels].some((label) => PROVIDER_PROMOTION_LABELS.has(label));
	const providerSocial = [...labels].some((label) => PROVIDER_SOCIAL_LABELS.has(label));
	const providerNotification = [...labels].some((label) => PROVIDER_NOTIFICATION_LABELS.has(label) || PROVIDER_FORUM_LABELS.has(label));
	const providerSpam = [...labels].some((label) => PROVIDER_SPAM_LABELS.has(label));
	if (providerPromotion) reasonCodes.push('PROVIDER_CATEGORY_PROMOTION');
	if (providerSocial) reasonCodes.push('PROVIDER_CATEGORY_SOCIAL');
	if (providerNotification) reasonCodes.push('PROVIDER_CATEGORY_NOTIFICATION');
	if (providerSpam) reasonCodes.push('PROVIDER_CATEGORY_SPAM');

	const campaign = Boolean(input.campaignId) || hasHeader(headers, 'x-campaign-id') || includesAny(headers['message-id'], ['campaign']);
	if (campaign) reasonCodes.push('CAMPAIGN_IDENTIFIER');
	const highTrackingDensity = trackingLinkCount >= 3 || (linkCount >= 6 && trackingLinkCount / Math.max(linkCount, 1) >= 0.5);
	if (highTrackingDensity) reasonCodes.push('HIGH_TRACKING_LINK_DENSITY');
	const largeFanout = recipientCount >= 10;
	if (largeFanout) reasonCodes.push('LARGE_RECIPIENT_FANOUT');
	const oneWaySender = receivedFromSenderCount >= 3 && sentToSenderCount === 0 && humanReplyCount === 0;
	if (oneWaySender) reasonCodes.push('ONE_WAY_SENDING_HISTORY');
	const sustainedBidirectional = humanReplyCount >= 2 && sentToSenderCount >= 2 && receivedFromSenderCount >= 2;
	if (sustainedBidirectional) reasonCodes.push('SUSTAINED_BIDIRECTIONAL_HUMAN_CORRESPONDENCE');

	return {
		headers,
		labels,
		reasonCodes: [...new Set(reasonCodes)],
		conflictingSignals,
		listSignals,
		autoSignals,
		promoWordCount,
		transactionWordCount,
		actionWordCount,
		securityWordCount,
		socialWordCount,
		providerPromotion,
		providerSocial,
		providerNotification,
		providerSpam,
		campaign,
		highTrackingDensity,
		largeFanout,
		oneWaySender,
		sustainedBidirectional
	};
}

function hasExplicitVipAuthority(input = {}) {
	return Boolean(input.explicitUserVipRef || input.adminVipPolicyRef);
}

function hasSupportedAutomaticVipAuthority(input = {}, signals) {
	return Boolean(
		input.verifiedEnterpriseDirectoryRoleRef ||
		input.missionCriticalContactRef ||
		input.verifiedCustomerKeyContactRef ||
		input.verifiedPartnerKeyContactRef ||
		signals.sustainedBidirectional
	);
}

function hasBulkOrPromotionalDisqualifier(signals) {
	return Boolean(
		signals.listSignals > 0 ||
		signals.providerPromotion ||
		signals.campaign ||
		signals.promoWordCount > 0 ||
		signals.highTrackingDensity ||
		signals.largeFanout ||
		signals.oneWaySender
	);
}

function choosePrimaryCategory(signals) {
	if (signals.providerSpam) return 'SPAM';
	if (signals.securityWordCount > 0 && signals.actionWordCount === 0) return 'NOTIFICATION';
	if (signals.providerPromotion || signals.promoWordCount > 0 || signals.campaign || signals.highTrackingDensity) return 'PROMOTION';
	if (signals.listSignals > 0 && signals.promoWordCount === 0) return 'NEWSLETTER';
	if (signals.providerSocial || signals.socialWordCount > 0) return 'SOCIAL';
	if (signals.transactionWordCount > 0) return 'TRANSACTIONAL';
	if (signals.providerNotification || signals.autoSignals > 0) return 'NOTIFICATION';
	if (signals.sustainedBidirectional) return 'PERSONAL';
	return 'UNCLASSIFIED';
}

function applyCorrections(decision, corrections = []) {
	for (const correction of corrections) {
		const type = correction.correctionType || correction.correction_type;
		const authoritySource = correction.authoritySource || correction.authority_source;
		const authorityRef = correction.authorityRef || correction.authority_ref;
		if (!authorityRef || !['USER', 'ADMIN'].includes(authoritySource)) continue;
		if (CORRECTION_CATEGORY[type]) {
			decision.primaryCategory = CORRECTION_CATEGORY[type];
			decision.authoritySource = authoritySource === 'ADMIN' ? 'ADMIN_POLICY' : 'USER_OVERRIDE';
			decision.userOverrideRef = authoritySource === 'USER' ? authorityRef : decision.userOverrideRef;
			decision.administratorOverrideRef = authoritySource === 'ADMIN' ? authorityRef : decision.administratorOverrideRef;
			decision.reasonCodes.push(`CORRECTION_${type}`);
		}
		if (type === 'MOVE_TO_VIP') {
			decision.vipRelationship = true;
			decision.vipAuthorityRef = authorityRef;
			decision.authoritySource = authoritySource === 'ADMIN' ? 'ADMIN_POLICY' : 'USER_OVERRIDE';
			decision.reasonCodes.push(`CORRECTION_${type}`);
		}
		if (type === 'REMOVE_FROM_VIP') {
			decision.vipRelationship = false;
			decision.vipAuthorityRef = null;
			decision.reasonCodes.push(`CORRECTION_${type}`);
		}
		if (type === 'MARK_PRIORITY') {
			decision.priorityLevel = 'HIGH';
			decision.reasonCodes.push(`CORRECTION_${type}`);
		}
		if (type === 'REMOVE_PRIORITY') {
			decision.priorityLevel = 'NONE';
			decision.reasonCodes.push(`CORRECTION_${type}`);
		}
		if (type === 'REQUIRES_ACTION') {
			decision.requiresAction = true;
			decision.reasonCodes.push(`CORRECTION_${type}`);
		}
		if (type === 'DOES_NOT_REQUIRE_ACTION') {
			decision.requiresAction = false;
			decision.reasonCodes.push(`CORRECTION_${type}`);
		}
	}
	return decision;
}

export function classifyMessage(input = {}, corrections = []) {
	const signals = collectSignals(input);
	const primaryCategory = choosePrimaryCategory(signals);
	const explicitVip = hasExplicitVipAuthority(input);
	const bulkOrPromoDisqualified = hasBulkOrPromotionalDisqualifier(signals);
	const automaticVip = !bulkOrPromoDisqualified && hasSupportedAutomaticVipAuthority(input, signals);
	const vipRelationship = explicitVip || automaticVip;
	const vipAuthorityRef = input.explicitUserVipRef || input.adminVipPolicyRef || input.verifiedEnterpriseDirectoryRoleRef || input.missionCriticalContactRef || input.verifiedCustomerKeyContactRef || input.verifiedPartnerKeyContactRef || (automaticVip ? 'SUSTAINED_BIDIRECTIONAL_HUMAN_CORRESPONDENCE' : null);
	const realAction = signals.actionWordCount > 0 && !signals.providerPromotion && signals.promoWordCount === 0;
	const priorityLevel = input.explicitPriorityRef || input.missionCriticalContactRef || (signals.securityWordCount > 0 && !signals.providerPromotion)
		? 'HIGH'
		: 'NONE';
	let confidence = 55;
	if (primaryCategory !== 'UNCLASSIFIED') confidence += 25;
	if (signals.listSignals > 0 || signals.providerPromotion || signals.providerSpam) confidence += 10;
	if (signals.reasonCodes.length >= 3) confidence += 5;
	confidence = Math.min(confidence, 99);

	const decision = {
		classifierVersion: CLASSIFIER_VERSION,
		rulesVersion: RULES_VERSION,
		modelVersion: MODEL_VERSION,
		primaryCategory,
		vipRelationship,
		priorityLevel,
		requiresAction: realAction,
		timeSensitive: Boolean(input.timeSensitive || realAction || input.explicitPriorityRef),
		unread: Boolean(input.unread),
		starred: Boolean(input.starred),
		hasAttachment: Boolean(input.hasAttachment),
		confidence,
		reasonCodes: [...signals.reasonCodes],
		conflictingSignals: signals.conflictingSignals,
		authoritySource: explicitVip ? 'USER_OVERRIDE' : 'DETERMINISTIC_RULES',
		vipAuthorityRef,
		userOverrideRef: input.explicitUserVipRef || null,
		administratorOverrideRef: input.adminVipPolicyRef || null,
		evidence: {
			signals: {
				listSignals: signals.listSignals,
				autoSignals: signals.autoSignals,
				providerPromotion: signals.providerPromotion,
				providerSocial: signals.providerSocial,
				providerNotification: signals.providerNotification,
				providerSpam: signals.providerSpam,
				campaign: signals.campaign,
				highTrackingDensity: signals.highTrackingDensity,
				largeFanout: signals.largeFanout,
				oneWaySender: signals.oneWaySender,
				sustainedBidirectional: signals.sustainedBidirectional
			},
			bodyPersisted: false
		}
	};

	if (bulkOrPromoDisqualified && !explicitVip) {
		decision.vipRelationship = false;
		decision.vipAuthorityRef = null;
		decision.reasonCodes.push('VIP_AUTOMATIC_DISQUALIFIED_BULK_OR_PROMOTION');
	}

	return normalizeDecision(applyCorrections(decision, corrections));
}

function normalizeDecision(decision) {
	decision.reasonCodes = [...new Set(decision.reasonCodes)];
	decision.conflictingSignals = [...new Set(decision.conflictingSignals || [])];
	if (!decision.vipRelationship) decision.vipAuthorityRef = null;
	if (!decision.requiresAction && decision.primaryCategory === 'PROMOTION') {
		decision.reasonCodes.push('MARKETING_URGENCY_NOT_ACTION_AUTHORITY');
	}
	if (decision.primaryCategory === 'UNCLASSIFIED') {
		decision.priorityLevel = decision.priorityLevel === 'CRITICAL' ? 'HIGH' : decision.priorityLevel;
	}
	return decision;
}

function nowIso() {
	return new Date().toISOString();
}

function uuid() {
	return globalThis.crypto?.randomUUID?.() || stableFingerprint([Date.now(), Math.random()]);
}

function assertScope(scope) {
	const tenantId = Number(scope?.tenantId);
	const workspaceId = Number(scope?.workspaceId);
	if (!Number.isInteger(tenantId) || tenantId <= 0) throw new Error('tenantId is required');
	if (!Number.isInteger(workspaceId) || workspaceId <= 0) throw new Error('workspaceId is required');
	return { tenantId, workspaceId };
}

function validateCorrection(correction = {}) {
	const type = correction.correctionType || correction.correction_type;
	if (![
		'MOVE_TO_VIP','REMOVE_FROM_VIP','MARK_PRIORITY','REMOVE_PRIORITY',
		'REQUIRES_ACTION','DOES_NOT_REQUIRE_ACTION','MARK_TRANSACTIONAL',
		'MARK_NOTIFICATION','MARK_NEWSLETTER','MARK_PROMOTION','MARK_SOCIAL',
		'MARK_SPAM','MARK_NOT_SPAM'
	].includes(type)) throw new Error('unsupported correctionType');
	const authoritySource = correction.authoritySource || correction.authority_source;
	if (!['USER', 'ADMIN'].includes(authoritySource)) throw new Error('authoritySource must be USER or ADMIN');
	if (!correction.authorityRef && !correction.authority_ref) throw new Error('authorityRef is required');
	return {
		correctionType: type,
		authoritySource,
		authorityRef: correction.authorityRef || correction.authority_ref,
		reasonCodes: correction.reasonCodes || parseJsonArray(correction.reason_codes_json)
	};
}

async function loadCorrections(c, scope, message) {
	const rows = await c.env.db.prepare(
		`SELECT correction_type, authority_source, authority_ref, reason_codes_json
		 FROM nexora_email_classification_corrections
		 WHERE tenant_id=?1 AND workspace_id=?2 AND customer_domain=?3 AND provider=?4 AND provider_account_hash=?5 AND message_fingerprint=?6
		 ORDER BY generation ASC, created_at ASC`
	).bind(scope.tenantId, scope.workspaceId, message.customerDomain, message.provider, message.providerAccountHash, message.messageFingerprint).all();
	return (rows.results || []).map((row) => ({
		correctionType: row.correction_type,
		authoritySource: row.authority_source,
		authorityRef: row.authority_ref,
		reasonCodes: parseJsonArray(row.reason_codes_json)
	}));
}

async function requireVerifiedDomainAuthority(c, scope, customerDomain) {
	const row = await c.env.db.prepare(
		`SELECT generation, verification_evidence_ref
		 FROM nexora_domain_authorities
		 WHERE tenant_id=?1 AND workspace_id=?2 AND normalized_domain=?3
		  AND verification_status='verified' AND revoked_at IS NULL
		 ORDER BY generation DESC LIMIT 1`
	).bind(scope.tenantId, scope.workspaceId, customerDomain).first();
	if (!row) throw new Error('verified Domain authority is required');
	return row;
}

export async function recordCorrection(c, scopeInput, messageInput, correctionInput) {
	const scope = assertScope(scopeInput);
	const customerDomain = normalizeDomain(messageInput.customerDomain || messageInput.domain);
	if (!customerDomain) throw new Error('customerDomain is required');
	await requireVerifiedDomainAuthority(c, scope, customerDomain);
	const correction = validateCorrection(correctionInput);
	const messageFingerprint = messageInput.messageFingerprint || buildMessageFingerprint(messageInput);
	const idempotencyKey = correctionInput.idempotencyKey || stableFingerprint([
		scope.tenantId,
		scope.workspaceId,
		customerDomain,
		messageInput.provider,
		messageInput.providerAccountHash,
		messageFingerprint,
		correction.correctionType,
		correction.authoritySource,
		correction.authorityRef
	]);
	await c.env.db.prepare(
		`INSERT OR IGNORE INTO nexora_email_classification_corrections
		 (id,tenant_id,workspace_id,provider,provider_account_hash,customer_domain,message_fingerprint,correction_type,authority_source,authority_ref,reason_codes_json,idempotency_key,generation)
		 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,
		  COALESCE((SELECT MAX(generation)+1 FROM nexora_email_classification_corrections WHERE tenant_id=?2 AND workspace_id=?3 AND customer_domain=?6 AND provider=?4 AND provider_account_hash=?5 AND message_fingerprint=?7),1))`
	).bind(
		uuid(),
		scope.tenantId,
		scope.workspaceId,
		messageInput.provider,
		messageInput.providerAccountHash,
		customerDomain,
		messageFingerprint,
		correction.correctionType,
		correction.authoritySource,
		correction.authorityRef,
		JSON.stringify(correction.reasonCodes),
		idempotencyKey
	).run();
	return { messageFingerprint, idempotencyKey, correction };
}

export async function classifyAndPersist(c, scopeInput, messageInput) {
	const scope = assertScope(scopeInput);
	const customerDomain = normalizeDomain(messageInput.customerDomain || messageInput.domain);
	if (!customerDomain) throw new Error('customerDomain is required');
	await requireVerifiedDomainAuthority(c, scope, customerDomain);
	const messageFingerprint = messageInput.messageFingerprint || buildMessageFingerprint(messageInput);
	const message = { ...messageInput, customerDomain, messageFingerprint };
	const corrections = await loadCorrections(c, scope, message);
	const decision = classifyMessage(message, corrections);
	const idempotencyKey = messageInput.idempotencyKey || stableFingerprint([
		scope.tenantId,
		scope.workspaceId,
		customerDomain,
		message.provider,
		message.providerAccountHash,
		messageFingerprint,
		decision.classifierVersion,
		decision.rulesVersion,
		JSON.stringify(corrections)
	]);
	const evidenceRef = stableFingerprint([
		idempotencyKey,
		decision.primaryCategory,
		decision.vipRelationship,
		decision.priorityLevel,
		decision.requiresAction,
		JSON.stringify(decision.reasonCodes)
	]);
	const rowId = uuid();
	await c.env.db.prepare(
		`INSERT INTO nexora_email_classifications
		 (id,tenant_id,workspace_id,provider,provider_account_hash,customer_domain,message_fingerprint,thread_fingerprint,primary_category,vip_relationship,priority_level,requires_action,time_sensitive,unread,starred,has_attachment,confidence,reason_codes_json,conflicting_signals_json,classifier_version,rules_version,model_version,authority_source,vip_authority_ref,user_override_ref,administrator_override_ref,evidence_ref,idempotency_key,generation,classified_at,updated_at)
		 VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19,?20,?21,?22,?23,?24,?25,?26,?27,?28,
		  COALESCE((SELECT generation+1 FROM nexora_email_classifications WHERE tenant_id=?2 AND workspace_id=?3 AND customer_domain=?6 AND provider=?4 AND provider_account_hash=?5 AND message_fingerprint=?7),1),?29,?29)
		 ON CONFLICT(tenant_id,workspace_id,customer_domain,provider,provider_account_hash,message_fingerprint) DO UPDATE SET
		  primary_category=excluded.primary_category,
		  vip_relationship=excluded.vip_relationship,
		  priority_level=excluded.priority_level,
		  requires_action=excluded.requires_action,
		  time_sensitive=excluded.time_sensitive,
		  unread=excluded.unread,
		  starred=excluded.starred,
		  has_attachment=excluded.has_attachment,
		  confidence=excluded.confidence,
		  reason_codes_json=excluded.reason_codes_json,
		  conflicting_signals_json=excluded.conflicting_signals_json,
		  classifier_version=excluded.classifier_version,
		  rules_version=excluded.rules_version,
		  model_version=excluded.model_version,
		  authority_source=excluded.authority_source,
		  vip_authority_ref=excluded.vip_authority_ref,
		  user_override_ref=excluded.user_override_ref,
		  administrator_override_ref=excluded.administrator_override_ref,
		  evidence_ref=excluded.evidence_ref,
		  idempotency_key=excluded.idempotency_key,
		  generation=excluded.generation,
		  classified_at=excluded.classified_at,
		  updated_at=excluded.updated_at`
	).bind(
		rowId,
		scope.tenantId,
		scope.workspaceId,
		message.provider,
		message.providerAccountHash,
		customerDomain,
		messageFingerprint,
		message.threadFingerprint || null,
		decision.primaryCategory,
		decision.vipRelationship ? 1 : 0,
		decision.priorityLevel,
		decision.requiresAction ? 1 : 0,
		decision.timeSensitive ? 1 : 0,
		decision.unread ? 1 : 0,
		decision.starred ? 1 : 0,
		decision.hasAttachment ? 1 : 0,
		decision.confidence,
		JSON.stringify(decision.reasonCodes),
		JSON.stringify(decision.conflictingSignals),
		decision.classifierVersion,
		decision.rulesVersion,
		decision.modelVersion,
		decision.authoritySource,
		decision.vipAuthorityRef,
		decision.userOverrideRef,
		decision.administratorOverrideRef,
		evidenceRef,
		idempotencyKey,
		nowIso()
	).run();
	await c.env.db.prepare(
		`INSERT INTO nexora_email_classification_evidence
		 (id,tenant_id,workspace_id,provider,customer_domain,message_fingerprint,evidence_kind,evidence_json,redaction_level)
		 VALUES(?1,?2,?3,?4,?5,?6,'CLASSIFICATION_DECISION',?7,'BODYLESS')`
	).bind(
		uuid(),
		scope.tenantId,
		scope.workspaceId,
		message.provider,
		customerDomain,
		messageFingerprint,
		JSON.stringify({
			evidenceRef,
			classifierVersion: decision.classifierVersion,
			rulesVersion: decision.rulesVersion,
			modelVersion: decision.modelVersion,
			primaryCategory: decision.primaryCategory,
			vipRelationship: decision.vipRelationship,
			priorityLevel: decision.priorityLevel,
			requiresAction: decision.requiresAction,
			confidence: decision.confidence,
			reasonCodes: decision.reasonCodes,
			conflictingSignals: decision.conflictingSignals,
			bodyPersisted: false
		})
	).run();
	return { messageFingerprint, evidenceRef, idempotencyKey, ...decision };
}

export default {
	CLASSIFIER_VERSION,
	RULES_VERSION,
	MODEL_VERSION,
	SEMANTIC_CATEGORIES,
	stableFingerprint,
	normalizeDomain,
	normalizeAddress,
	buildMessageFingerprint,
	classifyMessage,
	classifyAndPersist,
	recordCorrection
};
