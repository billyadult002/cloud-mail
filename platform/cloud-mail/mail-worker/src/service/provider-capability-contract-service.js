// Provider-agnostic decision kernel. Adapters supply only safe snapshots, never credentials.
const RESULTS = Object.freeze(['allowed','approval_required','capability_unavailable','authorization_missing','authorization_stale','needs_reconnect','provider_degraded','temporarily_unavailable','policy_denied','blocked']);
function decide({ scopeValid, identityValid, credentialStatus, credentialGenerationValid, authorityStatus, capabilities = [], requirement, policyAllowed = true, approvalValid = false, paramsValid = true, fencingValid = true, now = Date.now() }) {
	const deny = (result, reason) => ({ result, reasonCodes: [reason], providerToolPermitted: false });
	if (!scopeValid || !identityValid || !paramsValid || !fencingValid) return deny('blocked', 'scope_identity_params_or_fencing_mismatch');
	if (credentialStatus === 'missing' || credentialStatus === 'revoked' || credentialStatus === 'invalid') return deny('needs_reconnect', 'credential_reauthorization_required');
	if (credentialStatus === 'stale' || !credentialGenerationValid) return deny('authorization_stale', 'authorization_generation_stale');
	if (authorityStatus !== 'active') return deny('authorization_missing', 'authority_missing_or_insufficient');
	if (!policyAllowed) return deny('policy_denied', 'policy_denied');
	const required = new Set(requirement.requiredCapabilities || []); const selected = capabilities.filter(c => required.has(c.key));
	if (selected.some(c => c.status === 'temporarily_unavailable')) return deny('temporarily_unavailable', 'provider_temporarily_unavailable');
	if (selected.some(c => c.status === 'blocked')) return deny('blocked', 'provider_blocked');
	if (selected.some(c => c.status === 'unknown')) return deny('capability_unavailable', 'capability_unknown');
	if (selected.some(c => c.status === 'unsupported')) return deny('capability_unavailable', 'capability_unsupported');
	if (selected.some(c => c.expiresAt && Date.parse(c.expiresAt) <= now)) return deny('capability_unavailable', 'capability_evidence_stale');
	if (selected.some(c => c.status === 'degraded') && !requirement.allowDegraded) return deny('provider_degraded', 'capability_degraded');
	if (selected.length !== required.size) return deny('capability_unavailable', 'capability_missing');
	if (requirement.approvalRequired && !approvalValid) return deny('approval_required', 'exact_approval_missing');
	return { result: 'allowed', reasonCodes: selected.some(c => c.status === 'degraded') ? ['allowed_degraded'] : ['allowed'], providerToolPermitted: true };
}
export { RESULTS, decide };
export default { RESULTS, decide };
