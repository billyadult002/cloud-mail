// NEXORA evaluates mailbox onboarding authority once, from server-observed
// grants.  This module deliberately contains no credential values: a grant is
// evidence of a provider callback/probe, not client supplied OAuth data.

export const AddMailboxStatus = Object.freeze({
	READY_TO_ADD: 'READY_TO_ADD',
	DOMAIN_REUSED: 'DOMAIN_REUSED',
	MAILBOX_ALREADY_EXISTS: 'MAILBOX_ALREADY_EXISTS',
	USER_CONSENT_REQUIRED: 'USER_CONSENT_REQUIRED',
	ADMIN_CONSENT_REQUIRED: 'ADMIN_CONSENT_REQUIRED',
	PARTIAL_AUTHORITY_AVAILABLE: 'PARTIAL_AUTHORITY_AVAILABLE',
	PROVIDER_CAPABILITY_LIMITED: 'PROVIDER_CAPABILITY_LIMITED',
	POLICY_BLOCKED: 'POLICY_BLOCKED',
	SECURITY_BLOCKED: 'SECURITY_BLOCKED',
	PROVIDER_ERROR: 'PROVIDER_ERROR'
});

// This is the only onboarding vocabulary intended for product UI.  Provider,
// authorization, ownership, and routing implementation states remain separate
// inputs so a missing capability can never masquerade as an auth failure.
export const UniversalMailboxActivationState = Object.freeze({
	DISCOVERING: 'DISCOVERING',
	VERIFYING_OWNERSHIP: 'VERIFYING_OWNERSHIP',
	VERIFYING_IDENTITY: 'VERIFYING_IDENTITY',
	VERIFYING_ROUTING: 'VERIFYING_ROUTING',
	AWAITING_USER_ACTION: 'AWAITING_USER_ACTION',
	AWAITING_ADMIN_APPROVAL: 'AWAITING_ADMIN_APPROVAL',
	LIMITED_ACCESS: 'LIMITED_ACCESS',
	READY: 'READY',
	POLICY_BLOCKED: 'POLICY_BLOCKED',
	SECURITY_BLOCKED: 'SECURITY_BLOCKED',
	SYSTEM_ERROR: 'SYSTEM_ERROR'
});

const active = grant => ['AUTHORIZED', 'PARTIALLY_AUTHORIZED'].includes(String(grant?.authority_state || grant?.state || '').toUpperCase()) && grant?.revoked !== true;
const normalized = values => [...new Set((values || []).map(value => String(value).trim()).filter(Boolean))];

export function resolveUniversalMailboxActivation(input = {}) {
	const authorityStatus = input.authority_status || input.authorityStatus || AddMailboxStatus.USER_CONSENT_REQUIRED;
	const ownership = String(input.ownership_state || input.ownershipState || 'UNKNOWN').toUpperCase();
	const routing = String(input.routing_state || input.routingState || 'UNKNOWN').toUpperCase();
	const identity = String(input.identity_state || input.identityState || 'UNKNOWN').toUpperCase();
	const complete = value => ['VERIFIED', 'READY', 'AUTHORIZED', 'COMPLETE'].includes(value);
	const presentation = (state, label, reason, recommendedAction, primaryCta, progress) => ({ state, label, reason, recommended_action: recommendedAction, primary_cta: primaryCta, progress });

	if (authorityStatus === AddMailboxStatus.SECURITY_BLOCKED) return presentation(UniversalMailboxActivationState.SECURITY_BLOCKED, 'Security review required', 'A security policy prevents activation.', 'Review the security requirement.', 'Review Security', 100);
	if (authorityStatus === AddMailboxStatus.POLICY_BLOCKED) return presentation(UniversalMailboxActivationState.POLICY_BLOCKED, 'Blocked by workspace policy', 'This workspace policy does not permit mailbox activation.', 'Ask a workspace administrator to review the policy.', 'View Policy', 100);
	if (authorityStatus === AddMailboxStatus.PROVIDER_ERROR) return presentation(UniversalMailboxActivationState.SYSTEM_ERROR, 'Provider needs attention', 'NEXORA could not complete a provider check.', 'Retry the provider check.', 'Try Again', 0);
	if (authorityStatus === AddMailboxStatus.ADMIN_CONSENT_REQUIRED) return presentation(UniversalMailboxActivationState.AWAITING_ADMIN_APPROVAL, 'Admin approval required', 'Your provider requires an administrator to approve this mailbox connection.', 'Request administrator approval.', 'Request Approval', 35);
	if ([AddMailboxStatus.PARTIAL_AUTHORITY_AVAILABLE, AddMailboxStatus.PROVIDER_CAPABILITY_LIMITED].includes(authorityStatus)) return presentation(UniversalMailboxActivationState.LIMITED_ACCESS, 'Limited access', 'Core mailbox access is available, but optional provider features are unavailable.', 'Continue with the available features.', 'Continue Setup', 70);
	if (authorityStatus === AddMailboxStatus.USER_CONSENT_REQUIRED) return presentation(UniversalMailboxActivationState.AWAITING_USER_ACTION, 'Authorization required', 'NEXORA needs your one-time provider authorization to continue.', 'Authorize this mailbox securely in NEXORA.', 'Continue Setup', 25);
	if (!complete(identity) && identity !== 'UNKNOWN') return presentation(UniversalMailboxActivationState.VERIFYING_IDENTITY, 'Verifying identity', 'NEXORA is confirming the mailbox identity.', 'Keep NEXORA open while verification completes.', 'Check Status', 50);
	if (!complete(ownership)) return presentation(UniversalMailboxActivationState.VERIFYING_OWNERSHIP, 'Verifying ownership', 'Authorization is complete; NEXORA is confirming mailbox ownership.', 'Keep NEXORA open while verification completes.', 'Check Status', 65);
	if (!complete(routing)) return presentation(UniversalMailboxActivationState.VERIFYING_ROUTING, 'Verifying routing', 'Ownership is confirmed; NEXORA is validating mail routing.', 'Keep NEXORA open while verification completes.', 'Check Status', 80);
	if (authorityStatus === AddMailboxStatus.MAILBOX_ALREADY_EXISTS || authorityStatus === AddMailboxStatus.READY_TO_ADD) return presentation(UniversalMailboxActivationState.READY, 'Mailbox ready', 'The mailbox identity, ownership, and routing checks are complete.', 'Open the mailbox.', 'Open Mailbox', 100);
	return presentation(UniversalMailboxActivationState.DISCOVERING, 'Discovering mailbox', 'NEXORA is identifying the mailbox and its provider capabilities.', 'Keep NEXORA open while discovery completes.', 'Check Status', 10);
}

/**
 * Resolves the *effective* authority for an add-mailbox request.  A mailbox
 * grant is most specific; a verified domain may inherit from tenant or
 * organization authority.  Policy and security always outrank grants.
 */
export function resolveEffectiveAuthority(input = {}) {
	const grants = {
		mailbox: input.mailbox_grant || input.mailboxGrant || null,
		domain: input.domain_grant || input.domainGrant || null,
		tenant: input.tenant_grant || input.tenantGrant || null,
		organization: input.organization_grant || input.organizationGrant || null
	};
	const activeSources = Object.entries(grants).filter(([, grant]) => active(grant)).map(([source]) => source);
	const inherited = activeSources.filter(source => source !== 'mailbox');
	const provider = input.provider_capability || input.providerCapability || {};
	const coreSatisfied = provider.core_satisfied === true || provider.coreSatisfied === true || active(grants.mailbox);
	const optionalMissing = normalized(provider.optional_missing || provider.optionalMissing);
	const enterpriseRequired = normalized(provider.enterprise_required || provider.enterpriseRequired);
	const enterpriseAvailable = normalized(provider.enterprise_available || provider.enterpriseAvailable);
	const missingEnterprise = enterpriseRequired.filter(capability => !enterpriseAvailable.includes(capability));

	let status;
	if (input.security_blocked === true || input.securityBlocked === true) status = AddMailboxStatus.SECURITY_BLOCKED;
	else if (input.policy_blocked === true || input.policyBlocked === true) status = AddMailboxStatus.POLICY_BLOCKED;
	else if (input.mailbox_exists === true || input.mailboxExists === true) status = AddMailboxStatus.MAILBOX_ALREADY_EXISTS;
	else if (provider.provider_error === true || provider.providerError === true) status = AddMailboxStatus.PROVIDER_ERROR;
	else if (missingEnterprise.length) status = AddMailboxStatus.PROVIDER_CAPABILITY_LIMITED;
	else if (coreSatisfied && optionalMissing.length) status = AddMailboxStatus.PARTIAL_AUTHORITY_AVAILABLE;
	else if (coreSatisfied) status = AddMailboxStatus.READY_TO_ADD;
	// A verified, connected domain is reusable authority. It must never become a
	// generic blocked state merely because the new mailbox has not consented yet.
	else if (inherited.length || input.domain_verified === true || input.domainVerified === true) status = AddMailboxStatus.USER_CONSENT_REQUIRED;
	else if (provider.admin_consent_required === true || provider.adminConsentRequired === true) status = AddMailboxStatus.ADMIN_CONSENT_REQUIRED;
	else status = AddMailboxStatus.USER_CONSENT_REQUIRED;

	const activation = resolveUniversalMailboxActivation({
		authority_status: status,
		ownership_state: input.ownership_state || input.ownershipState,
		routing_state: input.routing_state || input.routingState,
		identity_state: input.identity_state || input.identityState
	});
	return {
		status,
		effective_authority: {
			mailbox: active(grants.mailbox),
			domain: active(grants.domain),
			tenant: active(grants.tenant),
			organization: active(grants.organization),
			inherited_from: inherited,
			provider_core_satisfied: coreSatisfied,
			optional_missing: optionalMissing,
			missing_enterprise_capabilities: missingEnterprise
		},
		domain_reused: Boolean(inherited.length || input.domain_verified === true || input.domainVerified === true),
		blocked: [AddMailboxStatus.POLICY_BLOCKED, AddMailboxStatus.SECURITY_BLOCKED].includes(status),
		user_consent_required: status === AddMailboxStatus.USER_CONSENT_REQUIRED,
		admin_consent_required: status === AddMailboxStatus.ADMIN_CONSENT_REQUIRED,
		ui: uiStatus(status),
		activation
	};
}

export function uiStatus(status) {
	const mapping = {
		[AddMailboxStatus.READY_TO_ADD]: { label: 'Ready to add', blocked: false },
		[AddMailboxStatus.DOMAIN_REUSED]: { label: 'Existing domain reused', blocked: false },
		[AddMailboxStatus.MAILBOX_ALREADY_EXISTS]: { label: 'Mailbox already exists', blocked: false },
		[AddMailboxStatus.USER_CONSENT_REQUIRED]: { label: 'Authorization required', blocked: false },
		[AddMailboxStatus.ADMIN_CONSENT_REQUIRED]: { label: 'Admin approval required', blocked: false },
		[AddMailboxStatus.PARTIAL_AUTHORITY_AVAILABLE]: { label: 'Limited access', blocked: false },
		[AddMailboxStatus.PROVIDER_CAPABILITY_LIMITED]: { label: 'Provider limitation', blocked: false },
		[AddMailboxStatus.POLICY_BLOCKED]: { label: 'Blocked by workspace policy', blocked: true },
		[AddMailboxStatus.SECURITY_BLOCKED]: { label: 'Blocked by security policy', blocked: true },
		[AddMailboxStatus.PROVIDER_ERROR]: { label: 'Provider error', blocked: false }
	};
	return mapping[status] || { label: 'Authorization required', blocked: false };
}

export default { AddMailboxStatus, UniversalMailboxActivationState, resolveUniversalMailboxActivation, resolveEffectiveAuthority, uiStatus };
