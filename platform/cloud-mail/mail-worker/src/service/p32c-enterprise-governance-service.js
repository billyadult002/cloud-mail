import p31DomainFoundationService from './p31-domain-foundation-service';

export const SecurityVerdictState = Object.freeze({
	PASS: 'PASS',
	WARN: 'WARN',
	SUSPICIOUS: 'SUSPICIOUS',
	QUARANTINE_RECOMMENDED: 'QUARANTINE_RECOMMENDED',
	BLOCKED: 'BLOCKED',
	UNKNOWN: 'UNKNOWN'
});

export const MessageLifecycleState = Object.freeze({
	ACTIVE: 'ACTIVE',
	HELD: 'HELD',
	RETAINED: 'RETAINED',
	EXPIRED_PENDING: 'EXPIRED_PENDING',
	SOFT_DELETED: 'SOFT_DELETED',
	PURGE_ELIGIBLE: 'PURGE_ELIGIBLE',
	PURGED: 'PURGED',
	REVOKED: 'REVOKED',
	DISABLED: 'DISABLED'
});

export const MessageEventType = Object.freeze({
	RECEIVED: 'received',
	PARSED: 'parsed',
	QUARANTINED: 'quarantined',
	QUEUED: 'queued',
	PROVIDER_ACCEPTED: 'provider_accepted',
	DELIVERED_IF_PROVEN: 'delivered_if_proven',
	BOUNCED: 'bounced',
	FAILED: 'failed',
	RETRIED: 'retried',
	CANCELLED: 'cancelled',
	READ_IF_OBSERVED: 'read_if_observed',
	SECURE_LINK_CREATED: 'secure_link_created',
	SECURE_LINK_OPENED: 'secure_link_opened',
	SECURE_LINK_REVOKED: 'secure_link_revoked',
	EXPIRED: 'expired',
	RETAINED: 'retained',
	HELD: 'held',
	SOFT_DELETED: 'soft_deleted',
	PURGED: 'purged'
});

const LIFECYCLE_PRECEDENCE = 'Legal Hold > Retention Minimum > Expiration > User Delete';

function normalizeDomain(value) {
	return String(value || '').trim().toLowerCase().replace(/^@+/, '').replace(/\.$/, '');
}

function dnsText(answer) {
	const data = String(answer?.data || '').trim();
	return data.replace(/^"|"$/g, '').replace(/"\s+"/g, '');
}

function dnsHost(answer) {
	return String(answer?.data || '').trim().replace(/\.$/, '').toLowerCase();
}

async function dnsQuery(domain, type) {
	const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=${encodeURIComponent(type)}`, {
		headers: { accept: 'application/dns-json' }
	});
	const payload = await response.json().catch(() => ({}));
	return Array.isArray(payload.Answer) ? payload.Answer : [];
}

function desiredEnterpriseDnsState(domain, provider = {}) {
	const normalized = normalizeDomain(domain);
	const bounceHost = provider.returnPathHost || `bounce.${normalized}`;
	return [
		...p31DomainFoundationService.desiredDnsState(normalized),
		{ type: 'TXT', name: `_mta-sts.${normalized}`, content: 'v=STSv1; id=cloudmail-testing-v1', purpose: 'mta_sts_txt', policy_mode: 'testing' },
		{ type: 'TXT', name: `_smtp._tls.${normalized}`, content: `v=TLSRPTv1; rua=mailto:tlsrpt@${normalized}`, purpose: 'tls_rpt', report_destination_status: 'domain_local_part_unverified' },
		{ type: 'CNAME', name: `mta-sts.${normalized}`, content: 'policy-hosting-required.example.invalid', purpose: 'mta_sts_policy_host_metadata', metadata_only: true },
		{ type: 'TXT', name: `default._bimi.${normalized}`, content: 'v=BIMI1; l=; a=;', purpose: 'bimi_metadata_only', metadata_only: true },
		{ type: 'CNAME', name: bounceHost, content: provider.returnPathTarget || 'provider-return-path-required.example.invalid', purpose: 'provider_return_path_metadata', metadata_only: true }
	];
}

function enterpriseObservedDnsState(domain, answers = {}) {
	const normalized = normalizeDomain(domain);
	const txt = (answers.txt || []).map(dnsText);
	return {
		domain_name: normalized,
		mx: (answers.mx || []).map(dnsHost),
		txt,
		dkim: (answers.dkim || []).map(dnsText),
		dmarc: p31DomainFoundationService.evaluateDmarcRecords((answers.dmarc || []).map(dnsText)),
		mta_sts_txt: (answers.mtaStsTxt || []).map(dnsText),
		tls_rpt: (answers.tlsRpt || []).map(dnsText),
		bimi: (answers.bimi || []).map(dnsText),
		return_path: (answers.returnPath || []).map(dnsText)
	};
}

function matchingObservedValues(observed, desired) {
	const purpose = desired.purpose;
	if (purpose === 'mta_sts_txt') return observed.mta_sts_txt || [];
	if (purpose === 'tls_rpt') return observed.tls_rpt || [];
	if (purpose === 'bimi_metadata_only') return observed.bimi || [];
	if (purpose === 'dmarc_policy') return observed.dmarc.records || [];
	if (purpose === 'spf') return observed.txt?.filter(value => value.toLowerCase().includes('v=spf1')) || [];
	if (purpose === 'inbound_email_routing') return observed.mx || [];
	if (purpose === 'provider_return_path_metadata') return observed.return_path || [];
	return [];
}

function reconcileDesiredWithObserved(desiredRecords = [], observed = {}) {
	return desiredRecords.map(desired => {
		if (desired.metadata_only) {
			return { desired, status: 'METADATA_ONLY', action: 'document_only', destructive: false, drift: false };
		}
		if (desired.purpose === 'dmarc_policy') {
			const dmarc = observed.dmarc || { status: 'MISSING', records: [] };
			if (dmarc.status === 'READY') {
				return { desired, status: 'READY', action: 'preserve_existing_valid_dmarc', destructive: false, drift: false };
			}
			return { desired, status: dmarc.status, action: dmarc.status === 'MISSING' ? 'create_if_safe' : 'report_conflict', reason: dmarc.reason, destructive: false, drift: true };
		}
		const values = matchingObservedValues(observed, desired);
		const desiredContent = String(desired.content || '').toLowerCase();
		const exact = values.some(value => String(value).toLowerCase().includes(desiredContent.replace(/\.$/, '')));
		return {
			desired,
			status: exact ? 'READY' : values.length ? 'CONFLICTING' : 'MISSING',
			action: exact ? 'reuse_existing' : values.length ? 'report_conflict' : 'create_if_safe',
			destructive: false,
			drift: !exact
		};
	});
}

async function declarativeDomainReconciler(domain, options = {}) {
	const normalized = normalizeDomain(domain);
	const answers = options.answers || {
		mx: await dnsQuery(normalized, 'MX'),
		txt: await dnsQuery(normalized, 'TXT'),
		dkim: await dnsQuery(`cf2024-1._domainkey.${normalized}`, 'TXT'),
		dmarc: await dnsQuery(`_dmarc.${normalized}`, 'TXT'),
		mtaStsTxt: await dnsQuery(`_mta-sts.${normalized}`, 'TXT'),
		tlsRpt: await dnsQuery(`_smtp._tls.${normalized}`, 'TXT'),
		bimi: await dnsQuery(`default._bimi.${normalized}`, 'TXT'),
		returnPath: await dnsQuery(`bounce.${normalized}`, 'TXT')
	};
	const desired = desiredEnterpriseDnsState(normalized, options.provider || {});
	const observed = enterpriseObservedDnsState(normalized, answers);
	const plan = reconcileDesiredWithObserved(desired, observed);
	const drift = plan.filter(item => item.drift);
	return {
		domain_name: normalized,
		mode: options.apply === true ? 'apply-requested' : 'dry-run',
		apply_gate: options.apply === true ? 'requires_explicit_dns_write_path' : 'dry_run_default',
		desired_dns_state: desired,
		observed_dns_state: observed,
		plan,
		drift_detected: drift.length > 0,
		drift_alert: drift.length ? { severity: 'WARN', count: drift.length, blockers: drift.map(item => item.desired.purpose) } : null,
		audit_events: plan.map(item => ({
			action: item.action === 'create_if_safe' ? 'dns_change_proposed' : 'dns_state_evaluated',
			object_type: 'dns_record',
			object_id: item.desired.name,
			outcome: item.status
		})),
		destructive: false
	};
}

async function mtaStsTlsRptFoundation(domain, options = {}) {
	const normalized = normalizeDomain(domain);
	const observed = options.observed || enterpriseObservedDnsState(normalized, {
		mtaStsTxt: await dnsQuery(`_mta-sts.${normalized}`, 'TXT'),
		tlsRpt: await dnsQuery(`_smtp._tls.${normalized}`, 'TXT')
	});
	const mtaStsReady = observed.mta_sts_txt.some(value => value.toLowerCase().includes('v=stsv1'));
	const tlsRptReady = observed.tls_rpt.some(value => value.toLowerCase().includes('v=tlsrptv1'));
	return {
		domain_name: normalized,
		desired_policy_mode: options.policyMode || 'testing',
		mta_sts_txt_status: mtaStsReady ? 'READY' : 'MISSING',
		tls_rpt_status: tlsRptReady ? 'READY' : 'MISSING',
		policy_file_readiness: 'NOT_CLAIMED_WITHOUT_REAL_HTTPS_POLICY',
		certificate_https_readiness: 'METADATA_ONLY_NOT_PROBED',
		enforce_readiness: 'NOT_CLAIMED',
		bimi_status: 'METADATA_ONLY_NOT_BLOCKING',
		blockers: [
			...(mtaStsReady ? [] : ['_mta-sts_txt_missing']),
			...(tlsRptReady ? [] : ['tls_rpt_txt_missing']),
			'mta_sts_policy_file_not_verified'
		],
		destructive: false
	};
}

function inboundSecurityAssessment(input = {}) {
	const spf = String(input.spf_result || input.spfResult || 'UNKNOWN').toUpperCase();
	const dkim = String(input.dkim_result || input.dkimResult || 'UNKNOWN').toUpperCase();
	const dmarc = String(input.dmarc_result || input.dmarcResult || 'UNKNOWN').toUpperCase();
	const arc = String(input.arc_result || input.arcResult || 'UNKNOWN').toUpperCase();
	const attachmentRisk = Number(input.attachment_risk || input.attachmentRisk || 0);
	const urlRisk = Number(input.url_risk || input.urlRisk || 0);
	const spamScore = Number(input.spam_score || input.spamScore || 0);
	const phishingScore = Number(input.phishing_score || input.phishingScore || 0);
	const alignment = input.from_domain_alignment ?? input.fromDomainAlignment;
	const replyMismatch = Boolean(input.reply_to_mismatch || input.replyToMismatch);
	const displaySpoof = Boolean(input.display_name_spoof_flag || input.displayNameSpoofFlag);
	let verdict = SecurityVerdictState.UNKNOWN;
	if (spf === 'PASS' && dkim === 'PASS' && dmarc === 'PASS' && !replyMismatch && !displaySpoof && phishingScore < 40 && spamScore < 50) verdict = SecurityVerdictState.PASS;
	else if (phishingScore >= 90 || input.malware_blocked === true) verdict = SecurityVerdictState.BLOCKED;
	else if (phishingScore >= 70 || spamScore >= 80 || attachmentRisk >= 80 || urlRisk >= 80) verdict = SecurityVerdictState.QUARANTINE_RECOMMENDED;
	else if (dmarc === 'FAIL' || replyMismatch || displaySpoof || phishingScore >= 50) verdict = SecurityVerdictState.SUSPICIOUS;
	else if ([spf, dkim, dmarc, arc].includes('FAIL') || spamScore >= 50) verdict = SecurityVerdictState.WARN;
	return {
		spf_result: spf,
		dkim_result: dkim,
		dmarc_result: dmarc,
		arc_result: arc,
		from_domain_alignment: alignment === undefined ? 'UNKNOWN' : Boolean(alignment),
		reply_to_mismatch: replyMismatch,
		display_name_spoof_flag: displaySpoof,
		attachment_risk: attachmentRisk,
		url_risk: urlRisk,
		spam_score: spamScore,
		phishing_score: phishingScore,
		security_verdict: verdict,
		security_classification: verdict === SecurityVerdictState.PASS ? 'standard' : 'needs_review',
		quarantine_recommendation: [SecurityVerdictState.QUARANTINE_RECOMMENDED, SecurityVerdictState.BLOCKED].includes(verdict),
		content_logged: false,
		malware_scanning_claimed: false
	};
}

function lifecycleTransition(currentState = MessageLifecycleState.ACTIVE, request = {}, options = {}) {
	const legalHold = Boolean(options.legal_hold || options.legalHold);
	const retentionMinimumActive = Boolean(options.retention_minimum_active || options.retentionMinimumActive);
	const action = String(request.action || '').trim();
	if (legalHold && !['requestLegalHoldRelease'].includes(action)) {
		return { from: currentState, to: MessageLifecycleState.HELD, action, reason: 'legal_hold_overrides_retention_expiration_and_user_delete', precedence: LIFECYCLE_PRECEDENCE, destructive: false };
	}
	if (retentionMinimumActive && ['requestDelete', 'requestExpire', 'requestPurge', 'requestAdminDelete', 'requestAttachmentPrune'].includes(action)) {
		return { from: currentState, to: MessageLifecycleState.RETAINED, action, reason: 'retention_minimum_blocks_delete_expire_purge', precedence: LIFECYCLE_PRECEDENCE, destructive: false };
	}
	const transitions = {
		requestDelete: MessageLifecycleState.SOFT_DELETED,
		requestExpire: MessageLifecycleState.EXPIRED_PENDING,
		requestPurge: currentState === MessageLifecycleState.PURGE_ELIGIBLE ? MessageLifecycleState.PURGED : MessageLifecycleState.PURGE_ELIGIBLE,
		requestAdminDelete: MessageLifecycleState.SOFT_DELETED,
		requestAttachmentPrune: MessageLifecycleState.PURGE_ELIGIBLE,
		requestRevoke: MessageLifecycleState.REVOKED,
		requestLegalHoldApply: MessageLifecycleState.HELD,
		requestLegalHoldRelease: MessageLifecycleState.ACTIVE,
		requestDisable: MessageLifecycleState.DISABLED
	};
	return {
		from: currentState,
		to: transitions[action] || currentState,
		action,
		reason: transitions[action] ? 'dry_run_transition_planned' : 'unknown_request_preserved',
		precedence: LIFECYCLE_PRECEDENCE,
		destructive: false
	};
}

function lifecycleStateMachine() {
	return {
		states: Object.values(MessageLifecycleState),
		precedence: LIFECYCLE_PRECEDENCE,
		required_apis: [
			'requestDelete',
			'requestExpire',
			'requestPurge',
			'requestAdminDelete',
			'requestAttachmentPrune',
			'requestRevoke',
			'requestLegalHoldApply',
			'requestLegalHoldRelease'
		],
		non_destructive: true
	};
}

async function sha256Hex(value) {
	const data = new TextEncoder().encode(String(value));
	const hash = await crypto.subtle.digest('SHA-256', data);
	return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function auditEventPayload(input = {}) {
	return {
		event_id: input.event_id || input.eventId || `audit_${Date.now()}`,
		org_id: input.org_id || input.orgId || 'org_pending',
		tenant_id: input.tenant_id || input.tenantId || 'tenant_pending',
		actor_id: input.actor_id || input.actorId || 'system',
		actor_role: input.actor_role || input.actorRole || 'system',
		action: input.action || 'unknown',
		object_type: input.object_type || input.objectType || 'unknown',
		object_id: input.object_id || input.objectId || 'unknown',
		reason: input.reason || '',
		ip_or_context_ref: input.ip_or_context_ref || input.ipOrContextRef || 'context_ref_only',
		created_at: input.created_at || input.createdAt || new Date(0).toISOString(),
		prev_hash: input.prev_hash || input.prevHash || null
	};
}

async function appendOnlyAuditHashEvent(input = {}) {
	const payload = auditEventPayload(input);
	const canonical = JSON.stringify(payload, Object.keys(payload).sort());
	return {
		...payload,
		event_hash: await sha256Hex(canonical),
		append_only: true,
		tamper_evident: true,
		content_logged: false,
		write_pattern: 'same_transaction_or_outbox_pattern_required'
	};
}

function orgTenantRbacSeed() {
	const roles = ['OWNER', 'ADMIN', 'COMPLIANCE_OFFICER', 'AUDITOR', 'USER'];
	return {
		models: ['organization', 'tenant', 'domain_ownership', 'org_membership', 'role', 'permission', 'policy_scope', 'future_sso_connection', 'future_scim_provisioning'],
		roles,
		permissions: {
			OWNER: ['manage_org', 'manage_domains', 'manage_billing', 'manage_security_policy'],
			ADMIN: ['manage_users', 'manage_mailboxes', 'view_domain_health'],
			COMPLIANCE_OFFICER: ['manage_legal_hold', 'view_audit', 'export_compliance_metadata'],
			AUDITOR: ['view_audit', 'audit_admin_access'],
			USER: ['use_mailbox']
		},
		sensitive_actions_requiring_future_two_person_review: [
			'legal_hold_apply',
			'legal_hold_release',
			'full_mailbox_export',
			'domain_disconnect',
			'destructive_purge',
			'provider_credential_rotation'
		],
		single_user_flow_preserved: true
	};
}

function messageEventSpineEvent(input = {}) {
	const type = input.type || MessageEventType.RECEIVED;
	return {
		event_type: type,
		internal_message_id: input.internal_message_id || input.internalMessageId || null,
		message_id: input.message_id || input.messageId || null,
		delivery_truth_state: type === MessageEventType.DELIVERED_IF_PROVEN ? 'delivered_only_with_real_evidence' : type,
		provider_accepted_is_delivered: false,
		reusable_by: ['delivery_troubleshooting', 'audit_log', 'lifecycle_engine', 'compliance_export', 'all_mail_ledger'],
		content_logged: false
	};
}

function messageEventSpineContract() {
	return {
		events: Object.values(MessageEventType),
		primary_keys: ['internal_message_id', 'message_id'],
		provider_accepted_is_delivered: false,
		delivered_requires_real_evidence: true,
		reusable_by: ['delivery_troubleshooting', 'audit_log', 'lifecycle_engine', 'compliance_export', 'all_mail_ledger']
	};
}

function secureLinkLifecycleContract(input = {}) {
	const states = ['DRAFT', 'ACTIVE', 'EXPIRED', 'REVOKED', 'LEGAL_HOLD_LOCKED', 'DISABLED', 'FAILED'];
	const legalHold = Boolean(input.legal_hold || input.legalHold);
	return {
		states,
		operations: ['create', 'status', 'revoke', 'expire'],
		status: legalHold ? 'LEGAL_HOLD_LOCKED' : input.status || 'DRAFT',
		view_limit_metadata: true,
		attachment_download_policy_metadata: true,
		audit_events: ['secure_link_created', 'secure_link_opened', 'secure_link_revoked', 'secure_link_expired', 'secure_link_failed'],
		legal_hold_override: legalHold,
		external_smtp_recall_claimed: false,
		product_truth: 'CloudMail-to-external Gmail/Outlook normal SMTP mail cannot be physically recalled; only Secure Link Mail can be revoked.'
	};
}

function architectureAdrs() {
	return [
		{ id: 'ADR-P32C-001', title: 'MailProvider abstraction and provider fallback strategy', status: 'accepted' },
		{ id: 'ADR-P32C-002', title: 'Message lifecycle state machine as the only deletion/purge path', status: 'accepted' },
		{ id: 'ADR-P32C-003', title: 'Audit hash chain and audit-the-auditor requirement', status: 'accepted' },
		{ id: 'ADR-P32C-004', title: 'Org/tenant/RBAC foundation before P33', status: 'accepted' },
		{ id: 'ADR-P32C-005', title: 'Vault threat model placeholder: device-lock vault vs true E2EE vault', status: 'proposed' },
		{ id: 'ADR-P32C-006', title: 'AI policy by security classification', status: 'accepted', policy: {
			standard_mail: 'local_ai_allowed',
			confidential_mail: 'explicit_consent',
			secure_vault: 'ai_disabled_by_default',
			legal_hold: 'ai_access_audited'
		} }
	];
}

const p32cEnterpriseGovernanceService = {
	desiredEnterpriseDnsState,
	enterpriseObservedDnsState,
	reconcileDesiredWithObserved,
	declarativeDomainReconciler,
	mtaStsTlsRptFoundation,
	inboundSecurityAssessment,
	lifecycleStateMachine,
	lifecycleTransition,
	appendOnlyAuditHashEvent,
	orgTenantRbacSeed,
	messageEventSpineEvent,
	messageEventSpineContract,
	secureLinkLifecycleContract,
	architectureAdrs
};

export default p32cEnterpriseGovernanceService;
