export const CLASSIFIER_VERSION = 'nexora-option5-hybrid-classifier-v1';
export const RULES_VERSION = 'option5-deterministic-rules-v1';
export const MODEL_VERSION = null;

import {
	buildAtomicLedgerStatements,
	canonicalize,
	computeEvidenceIntegrity,
	verifyEvidenceChain
} from './nexora-evidence-ledger-service.mjs';
import { deriveSessionRef } from './nexora-session-ref-service.mjs';
import { normalizeBuild } from './nexora-runtime-correlation-service.mjs';

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

export function parseCanonicalMessageId(value) {
	const canonicalMessageId = Number(value);
	if (!Number.isInteger(canonicalMessageId) || canonicalMessageId <= 0) {
		throw new Error('canonicalMessageId is required');
	}
	return canonicalMessageId;
}

export function validateLegacyPersistPayload(input = {}) {
	for (const field of [
		'tenantId', 'tenant_id', 'workspaceId', 'workspace_id', 'accountId', 'account_id',
		'provider', 'providerAccountHash', 'provider_account_hash', 'customerDomain', 'domain'
	]) {
		if (input[field] !== undefined) throw new Error(`${field} is server-derived`);
	}
	if (input.message !== undefined) throw new Error('client-supplied message payload is not accepted');
	if (!String(input.acceptanceSessionId || input.interactionId || '').trim()) throw new Error('acceptanceSessionId is required');
	parseCanonicalMessageId(input.canonicalMessageId);
	return input;
}

function domainFromAddress(value) {
	const address = normalizeAddress(value);
	const separator = address.lastIndexOf('@');
	return separator >= 0 ? normalizeDomain(address.slice(separator + 1)) : '';
}

function platformToClientKind(platform) {
	return String(platform || '').toUpperCase() === 'IOS_PHYSICAL' ? 'IOS_PHYSICAL' :
		String(platform || '').toUpperCase() === 'DESKTOP' ? 'DESKTOP' : 'SERVICE';
}

function constantTimeEqual(left, right) {
	const a = String(left || '');
	const b = String(right || '');
	if (a.length !== b.length) return false;
	let mismatch = 0;
	for (let index = 0; index < a.length; index += 1) mismatch |= a.charCodeAt(index) ^ b.charCodeAt(index);
	return mismatch === 0;
}

async function assertAcceptanceContinuity(c, row) {
	if (String(row.hmac_key_version || '') !== String(c.env.NEXORA_CORRELATION_HMAC_KEY_VERSION || '')) {
		throw new Error('classification HMAC key version continuity denied');
	}
	const authorization = c.req?.header?.('authorization');
	if (!authorization) throw new Error('authenticated session reference is required');
	const currentAuthSessionRef = await deriveSessionRef(c.env, authorization);
	if (!constantTimeEqual(row.auth_session_ref, currentAuthSessionRef)) throw new Error('classification auth session continuity denied');
	const currentDeploymentId = String(c.env.CF_VERSION_METADATA?.id || '').trim();
	if (!currentDeploymentId || currentDeploymentId !== String(row.runtime_deployment_id || '')) {
		throw new Error('classification deployment continuity denied');
	}
	const build = normalizeBuild(c.env, {
		platform: row.client_kind,
		buildId: row.build_id,
		buildVersion: row.build_version,
		sourceCommit: row.source_commit
	});
	if (build.artifactDigest !== row.artifact_digest || build.sourceCommit !== row.source_commit ||
		build.signingIdentity !== row.signing_identity || build.signingKeyVersion !== row.signing_key_version ||
		build.policyVersion !== row.allowlist_policy_version) {
		throw new Error('classification build authority continuity denied');
	}
}

export async function loadCanonicalClassificationContext(c, input = {}) {
	const actorUserId = Number(input.actor?.userId);
	if (!Number.isInteger(actorUserId) || actorUserId <= 0) throw new Error('authenticated actor is required');
	const interactionId = String(input.acceptanceSessionId || input.interactionId || '').trim();
	if (!interactionId) throw new Error('acceptanceSessionId is required');
	const canonicalMessageId = parseCanonicalMessageId(input.canonicalMessageId);
	const row = await c.env.db.prepare(
		`SELECT s.id AS interaction_id,s.tenant_id,s.workspace_id,s.actor_user_id,s.canonical_account_id,
		 s.auth_session_ref,s.hmac_key_version,s.request_id,s.runtime_deployment_id,s.id AS acceptance_correlation_ref,
		 s.platform AS client_kind,s.build_id,s.build_version,s.artifact_digest,s.source_commit,
		 s.signing_identity,s.signing_key_version,s.allowlist_policy_version,
		 s.status AS interaction_status,s.expires_at AS interaction_expires_at,
		 e.email_id,e.account_id AS email_account_id,e.user_id AS email_user_id,e.send_email,e.subject,e.text,e.content,
		 e.message_id,e.resend_email_id,e.relation,e.in_reply_to,e.unread,e.create_time AS source_created_at,
		 a.account_id,a.user_id AS account_user_id,a.email AS account_email,a.domain AS account_domain,a.provider,a.sync_status,
		 da.id AS domain_authority_id,da.generation AS authority_generation,da.verification_evidence_ref AS authority_evidence_ref,
		 EXISTS(SELECT 1 FROM attachments att WHERE att.email_id=e.email_id) AS has_attachment,
		 EXISTS(SELECT 1 FROM star st WHERE st.email_id=e.email_id AND st.user_id=s.actor_user_id) AS starred
		 FROM nexora_runtime_acceptance_sessions s
		 JOIN workspace_members wm ON wm.workspace_id=s.workspace_id AND wm.user_id=s.actor_user_id
		 JOIN workspace_account_bindings wab ON wab.workspace_id=s.workspace_id AND wab.account_id=s.canonical_account_id
		 JOIN account a ON a.account_id=s.canonical_account_id AND a.user_id=s.actor_user_id AND a.is_del=0
		 JOIN email e ON e.email_id=?3 AND e.account_id=a.account_id AND e.user_id=s.actor_user_id AND e.is_del=0
		 JOIN nexora_domain_authorities da ON da.tenant_id=s.tenant_id AND da.workspace_id=s.workspace_id
		  AND da.normalized_domain=lower(COALESCE(NULLIF(a.domain,''),substr(a.email,instr(a.email,'@')+1)))
		  AND da.verification_status='verified' AND da.revoked_at IS NULL
		 WHERE s.id=?1 AND s.actor_user_id=?2 AND s.tenant_id=?2
		 LIMIT 1`
	).bind(interactionId, actorUserId, canonicalMessageId).first();
	if (!row) throw new Error('canonical classification context is not authorized');
	await assertAcceptanceContinuity(c, row);
	const interactionStatus = String(row.interaction_status || '').toUpperCase();
	const allowedStatuses = input.allowConsumed ? new Set(['ISSUED', 'CONSUMED']) : new Set(['ISSUED']);
	if (!allowedStatuses.has(interactionStatus)) {
		throw new Error('classification interaction is not active');
	}
	if (row.interaction_expires_at && Date.parse(row.interaction_expires_at) <= Date.now()) {
		throw new Error('classification interaction expired');
	}
	if (Number(row.canonical_account_id) !== Number(row.email_account_id) || Number(row.account_id) !== Number(row.email_account_id)) {
		throw new Error('interaction account does not match canonical message');
	}
	const customerDomain = normalizeDomain(row.account_domain) || domainFromAddress(row.account_email);
	if (!customerDomain) throw new Error('canonical account domain is required');
	const provider = normalizeLower(row.provider);
	if (!provider) throw new Error('canonical account provider is required');
	const providerAccountHash = stableFingerprint([
		'canonical-provider-account-v1', row.workspace_id, row.account_id, provider, normalizeAddress(row.account_email)
	]);
	const providerMessageId = String(row.message_id || row.resend_email_id || `email:${row.email_id}`);
	const sourceCreatedAt = String(row.source_created_at || '');
	if (!sourceCreatedAt) throw new Error('canonical message source timestamp is required');
	const message = {
		provider,
		providerAccountHash,
		customerDomain,
		canonicalMessageId: Number(row.email_id),
		canonicalAccountId: Number(row.account_id),
		messageId: providerMessageId,
		sender: row.send_email || '',
		subject: row.subject || '',
		snippet: row.text || '',
		threadId: row.relation || row.in_reply_to || providerMessageId,
		unread: Boolean(row.unread),
		starred: Boolean(row.starred),
		hasAttachment: Boolean(row.has_attachment),
		receivedAt: sourceCreatedAt
	};
	const messageFingerprint = buildMessageFingerprint(message);
	const provenanceRef = stableFingerprint([
		'nexora-canonical-email-provenance-v1', row.tenant_id, row.workspace_id, row.account_id,
		row.email_id, providerMessageId, sourceCreatedAt, messageFingerprint
	]);
	return {
		scope: { tenantId: Number(row.actor_user_id), workspaceId: Number(row.workspace_id) },
		message: { ...message, messageFingerprint },
		interaction: {
			id: String(row.interaction_id),
			authSessionRef: String(row.auth_session_ref || ''),
			requestId: String(row.request_id || ''),
			runtimeDeploymentId: String(row.runtime_deployment_id || ''),
			acceptanceCorrelationRef: String(row.acceptance_correlation_ref || row.interaction_id),
			clientKind: platformToClientKind(row.client_kind)
		},
		authority: {
			id: String(row.domain_authority_id || ''),
			generation: Number(row.authority_generation),
			evidenceRef: String(row.authority_evidence_ref || '')
		},
		provenance: {
			source: 'CANONICAL_EMAIL',
			canonicalMessageId: Number(row.email_id),
			canonicalAccountId: Number(row.account_id),
			sourceCreatedAt,
			provenanceRef,
			bodyPersisted: false
		}
	};
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

async function loadLedgerHead(c, canonical) {
	return c.env.db.prepare(
		`SELECT h.latest_generation,h.latest_event_id,h.latest_entry_digest,e.classification_id
		 FROM nexora_classification_ledger_heads h
		 LEFT JOIN nexora_email_classification_events e ON e.id=h.latest_event_id
		 WHERE h.tenant_id=?1 AND h.workspace_id=?2 AND h.customer_domain=?3 AND h.provider=?4
		  AND h.canonical_account_id=?5 AND h.canonical_message_id=?6 LIMIT 1`
	).bind(
		canonical.scope.tenantId, canonical.scope.workspaceId, canonical.message.customerDomain,
		canonical.message.provider, canonical.message.canonicalAccountId, String(canonical.message.canonicalMessageId)
	).first();
}

async function loadIdempotentClassification(c, canonical, idempotencyKey) {
	return c.env.db.prepare(
		`SELECT r.id AS run_id,r.input_digest,e.id AS event_id,e.classification_id,e.generation,e.message_fingerprint,
		 e.primary_category,e.vip_relationship,e.priority_level,e.requires_action,e.time_sensitive,e.unread,e.starred,
		 e.has_attachment,e.confidence,e.reason_codes_json,e.conflicting_signals_json,e.authority_source,
		 e.classified_at,v.id AS evidence_id,v.entry_digest
		 FROM nexora_classification_runs r
		 JOIN nexora_email_classification_events e ON e.run_id=r.id
		 JOIN nexora_email_classification_evidence_v2 v ON v.event_id=e.id AND v.run_id=r.id
		 WHERE r.tenant_id=?1 AND r.workspace_id=?2 AND r.idempotency_key=?3
		  AND e.canonical_account_id=?4 AND e.canonical_message_id=?5 LIMIT 1`
	).bind(
		canonical.scope.tenantId, canonical.scope.workspaceId, `run:${idempotencyKey}`,
		canonical.message.canonicalAccountId, String(canonical.message.canonicalMessageId)
	).first();
}

function assertCorrelationAuthority(canonical) {
	for (const [name, value] of Object.entries({
		'domain authority': canonical.authority.id,
		'domain authority evidence': canonical.authority.evidenceRef,
		'auth session reference': canonical.interaction.authSessionRef,
		'request identity': canonical.interaction.requestId,
		'runtime deployment identity': canonical.interaction.runtimeDeploymentId,
		'acceptance correlation reference': canonical.interaction.acceptanceCorrelationRef
	})) {
		if (!String(value || '').trim()) throw new Error(`${name} is required`);
	}
	if (!Number.isInteger(canonical.authority.generation) || canonical.authority.generation <= 0) {
		throw new Error('domain authority generation is required');
	}
}

export async function classifyCanonicalAndPersist(c, input = {}) {
	validateLegacyPersistPayload(input);
	const canonical = await loadCanonicalClassificationContext(c, input);
	assertCorrelationAuthority(canonical);
	const corrections = await loadCorrections(c, canonical.scope, canonical.message);
	const decision = classifyMessage(canonical.message, corrections);
	const head = await loadLedgerHead(c, canonical);
	const expectedGeneration = Number(head?.latest_generation || 0);
	const generation = expectedGeneration + 1;
	const classifiedAt = nowIso();
	const classificationId = String(head?.classification_id || uuid());
	const runId = uuid();
	const eventId = uuid();
	const evidenceId = uuid();
	const idempotencyKey = stableFingerprint([
		'nexora-canonical-classification-v2', canonical.scope.tenantId, canonical.scope.workspaceId,
		canonical.interaction.id, canonical.message.canonicalAccountId, canonical.message.canonicalMessageId,
		CLASSIFIER_VERSION, RULES_VERSION
	]);
	const replay = await loadIdempotentClassification(c, canonical, idempotencyKey);
	const payload = {
		bodyPersisted: false,
		redactionLevel: 'BODYLESS',
		provenance: canonical.provenance,
		classifierVersion: CLASSIFIER_VERSION,
		rulesVersion: RULES_VERSION,
		modelVersion: MODEL_VERSION,
		primaryCategory: decision.primaryCategory,
		vipRelationship: decision.vipRelationship,
		priorityLevel: decision.priorityLevel,
		requiresAction: decision.requiresAction,
		timeSensitive: decision.timeSensitive,
		unread: decision.unread,
		starred: decision.starred,
		hasAttachment: decision.hasAttachment,
		confidence: decision.confidence,
		reasonCodes: decision.reasonCodes,
		conflictingSignals: decision.conflictingSignals
	};
	const canonicalPayloadJson = canonicalize(payload);
	const ledgerInput = {
		run: {
			id: runId,
			tenantId: canonical.scope.tenantId,
			workspaceId: canonical.scope.workspaceId,
			domainAuthorityId: canonical.authority.id,
			authorityGeneration: canonical.authority.generation,
			authorityEvidenceRef: canonical.authority.evidenceRef,
			actorUserId: canonical.scope.tenantId,
			authSessionRef: canonical.interaction.authSessionRef,
			hmacKeyVersion: String(c.env.NEXORA_CORRELATION_HMAC_KEY_VERSION || ''),
			canonicalAccountId: canonical.message.canonicalAccountId,
			providerAccountHash: canonical.message.providerAccountHash,
			requestId: canonical.interaction.requestId,
			runtimeDeploymentId: canonical.interaction.runtimeDeploymentId,
			acceptanceCorrelationRef: canonical.interaction.acceptanceCorrelationRef,
			clientKind: canonical.interaction.clientKind,
			classifierVersion: CLASSIFIER_VERSION,
			rulesVersion: RULES_VERSION,
			modelVersion: MODEL_VERSION,
			inputDigest: null,
			idempotencyKey: `run:${idempotencyKey}`,
			startedAt: classifiedAt
		},
		event: {
			id: eventId,
			classificationId,
			customerDomain: canonical.message.customerDomain,
			provider: canonical.message.provider,
			canonicalMessageId: String(canonical.message.canonicalMessageId),
			messageFingerprint: canonical.message.messageFingerprint,
			threadFingerprint: canonical.message.threadId ? stableFingerprint(['thread', canonical.message.threadId]) : null,
			sourceCreatedAt: canonical.provenance.sourceCreatedAt,
			provenanceRef: canonical.provenance.provenanceRef,
			generation,
			previousEventId: head?.latest_event_id || null,
			previousEntryDigest: head?.latest_entry_digest || null,
			primaryCategory: decision.primaryCategory,
			vipRelationship: decision.vipRelationship,
			priorityLevel: decision.priorityLevel,
			requiresAction: decision.requiresAction,
			timeSensitive: decision.timeSensitive,
			unread: decision.unread,
			starred: decision.starred,
			hasAttachment: decision.hasAttachment,
			confidence: decision.confidence,
			reasonCodesJson: JSON.stringify(decision.reasonCodes),
			conflictingSignalsJson: JSON.stringify(decision.conflictingSignals),
			authoritySource: decision.authoritySource,
			vipAuthorityRef: decision.vipAuthorityRef,
			userOverrideRef: decision.userOverrideRef,
			administratorOverrideRef: decision.administratorOverrideRef,
			decisionDigest: null,
			evidenceId,
			idempotencyKey: `event:${idempotencyKey}`,
			classifiedAt
		},
		evidence: {
			canonicalPayloadJson,
			payloadDigest: null,
			entryDigest: null,
			observedAt: classifiedAt
		},
		head: {
			expectedGeneration,
			expectedEntryDigest: head?.latest_entry_digest || null
		}
	};
	const integrity = await computeEvidenceIntegrity(ledgerInput);
	Object.assign(ledgerInput.run, { inputDigest: integrity.inputDigest });
	Object.assign(ledgerInput.event, { decisionDigest: integrity.decisionDigest });
	Object.assign(ledgerInput.evidence, {
		payloadDigest: integrity.payloadDigest,
		entryDigest: integrity.entryDigest,
		canonicalPayloadJson: integrity.canonicalPayloadJson
	});
	if (replay) {
		const replayMatchesDecision = replay.input_digest === integrity.inputDigest &&
			replay.message_fingerprint === canonical.message.messageFingerprint &&
			replay.primary_category === decision.primaryCategory &&
			Boolean(replay.vip_relationship) === Boolean(decision.vipRelationship) &&
			replay.priority_level === decision.priorityLevel &&
			Boolean(replay.requires_action) === Boolean(decision.requiresAction) &&
			Boolean(replay.time_sensitive) === Boolean(decision.timeSensitive) &&
			JSON.stringify(parseJsonArray(replay.reason_codes_json)) === JSON.stringify(decision.reasonCodes) &&
			JSON.stringify(parseJsonArray(replay.conflicting_signals_json)) === JSON.stringify(decision.conflictingSignals);
		if (!replayMatchesDecision) throw new Error('classification idempotency input conflict');
		return {
			classificationId: replay.classification_id, runId: replay.run_id, eventId: replay.event_id,
			evidenceId: replay.evidence_id, generation: Number(replay.generation),
			messageFingerprint: canonical.message.messageFingerprint, evidenceRef: replay.entry_digest,
			idempotencyKey, classifierVersion: CLASSIFIER_VERSION, rulesVersion: RULES_VERSION,
			modelVersion: MODEL_VERSION, primaryCategory: replay.primary_category,
			vipRelationship: Boolean(replay.vip_relationship), priorityLevel: replay.priority_level,
			requiresAction: Boolean(replay.requires_action), timeSensitive: Boolean(replay.time_sensitive),
			unread: Boolean(replay.unread), starred: Boolean(replay.starred),
			hasAttachment: Boolean(replay.has_attachment), confidence: Number(replay.confidence),
			reasonCodes: parseJsonArray(replay.reason_codes_json),
			conflictingSignals: parseJsonArray(replay.conflicting_signals_json),
			authoritySource: replay.authority_source, idempotentReplay: true,
			provenance: canonical.provenance,
			correlation: {
				acceptanceSessionId: canonical.interaction.id, requestId: canonical.interaction.requestId,
				runtimeDeploymentId: canonical.interaction.runtimeDeploymentId,
				clientKind: canonical.interaction.clientKind
			}
		};
	}
	const results = await c.env.db.batch(buildAtomicLedgerStatements(c.env.db, ledgerInput));
	for (const index of [1, 2, 3, 4, 5]) {
		if (Number(results?.[index]?.meta?.changes || 0) !== 1) {
			throw new Error('classification ledger atomic commit rejected');
		}
	}
	return {
		classificationId,
		runId,
		eventId,
		evidenceId,
		generation,
		messageFingerprint: canonical.message.messageFingerprint,
		evidenceRef: integrity.entryDigest,
		idempotencyKey,
		...decision,
		provenance: canonical.provenance,
		correlation: {
			acceptanceSessionId: canonical.interaction.id,
			requestId: canonical.interaction.requestId,
			runtimeDeploymentId: canonical.interaction.runtimeDeploymentId,
			clientKind: canonical.interaction.clientKind
		}
	};
}

export async function readCanonicalClassification(c, input = {}) {
	const canonical = await loadCanonicalClassificationContext(c, { ...input, allowConsumed: true });
	const projection = await c.env.db.prepare(
		`SELECT id,tenant_id,workspace_id,provider,provider_account_hash,customer_domain,message_fingerprint,
		 primary_category,vip_relationship,priority_level,requires_action,time_sensitive,unread,starred,has_attachment,
		 confidence,reason_codes_json,conflicting_signals_json,classifier_version,rules_version,model_version,
		 authority_source,evidence_ref,generation,classifier_version,current_event_id,current_evidence_id,
		 canonical_message_id,canonical_account_id,source_created_at,provenance_ref,classified_at,updated_at
		 FROM nexora_email_classifications
		 WHERE tenant_id=?1 AND workspace_id=?2 AND customer_domain=?3 AND provider=?4
		  AND canonical_account_id=?5 AND canonical_message_id=?6 LIMIT 1`
	).bind(
		canonical.scope.tenantId, canonical.scope.workspaceId, canonical.message.customerDomain,
		canonical.message.provider, canonical.message.canonicalAccountId, String(canonical.message.canonicalMessageId)
	).first();
	if (!projection) throw new Error('classification record not found');
	const verifiedEvidence = await verifyEvidenceChain(c.env.db, {
		tenantId: canonical.scope.tenantId,
		workspaceId: canonical.scope.workspaceId,
		customerDomain: canonical.message.customerDomain,
		provider: canonical.message.provider,
		canonicalAccountId: canonical.message.canonicalAccountId,
		canonicalMessageId: String(canonical.message.canonicalMessageId)
	});
	return {
		classification: {
			id: projection.id,
			messageFingerprint: projection.message_fingerprint,
			generation: Number(projection.generation),
			primaryCategory: projection.primary_category,
			vipRelationship: Boolean(projection.vip_relationship),
			priorityLevel: projection.priority_level,
			requiresAction: Boolean(projection.requires_action),
			timeSensitive: Boolean(projection.time_sensitive),
			unread: Boolean(projection.unread),
			starred: Boolean(projection.starred),
			hasAttachment: Boolean(projection.has_attachment),
			confidence: Number(projection.confidence),
			reasonCodes: parseJsonArray(projection.reason_codes_json),
			conflictingSignals: parseJsonArray(projection.conflicting_signals_json),
			classifierVersion: projection.classifier_version,
			rulesVersion: projection.rules_version,
			modelVersion: projection.model_version,
			authoritySource: projection.authority_source,
			evidenceRef: projection.evidence_ref,
			classifiedAt: projection.classified_at,
			updatedAt: projection.updated_at
		},
		provenance: canonical.provenance,
		evidenceIntegrity: {
			valid: verifiedEvidence.valid,
			generation: Number(verifiedEvidence.head.latest_generation),
			entryDigest: verifiedEvidence.head.latest_entry_digest
		},
		evidence: verifiedEvidence.entries.map((row) => ({
			eventId: row.event_id,
			evidenceId: row.evidence_id,
			runId: row.run_id,
			generation: Number(row.generation),
			previousEventId: row.previous_event_id || null,
			previousEntryDigest: row.previous_entry_digest || null,
			entryDigest: row.entry_digest,
			payloadDigest: row.payload_digest,
			redactionLevel: row.redaction_level,
			bodyPersisted: Boolean(row.body_persisted),
			observedAt: row.observed_at,
			requestId: row.request_id,
			runtimeDeploymentId: row.runtime_deployment_id,
			acceptanceCorrelationRef: row.acceptance_correlation_ref
		}))
	};
}

export async function classifyAndPersist() {
	throw new Error('canonical classification interaction is required');
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
	validateLegacyPersistPayload,
	loadCanonicalClassificationContext,
	classifyCanonicalAndPersist,
	readCanonicalClassification,
	classifyAndPersist,
	recordCorrection
};
