// NEXORA Zero-Touch onboarding: provider discovery (Required Output #17). Deterministic,
// non-secret signal evaluation -- no network calls in this pass (MX/OpenID discovery would
// require a live DNS/HTTP lookup, out of this logic-complete pass's scope; the confidence
// model below is designed so a real network signal can be added later as one more weighted
// input without changing the decision contract). Never silently guesses: below the confidence
// threshold, the caller must ask the user one minimal choice rather than picking a provider.
const KNOWN_GOOGLE_DOMAINS = new Set(['gmail.com', 'googlemail.com']);
const KNOWN_MICROSOFT_CONSUMER_DOMAINS = new Set(['outlook.com', 'hotmail.com', 'live.com', 'msn.com']);
const CONFIDENCE_THRESHOLD = 0.7;

function domainOf(email) {
	const at = String(email || '').lastIndexOf('@');
	return at === -1 ? '' : String(email).slice(at + 1).toLowerCase();
}

// Each signal contributes an independent confidence weight toward one provider. Signals never
// veto each other silently -- conflicting signals reduce overall confidence rather than one
// arbitrarily overriding another, so a genuinely ambiguous case correctly falls below threshold.
function evaluateSignals({ email, existingConnectionProvider, organizationPolicyProvider, microsoftTenantHint, capabilityProbeResult }) {
	const domain = domainOf(email);
	const signals = [];

	if (existingConnectionProvider) signals.push({ provider: existingConnectionProvider, weight: 0.9, source: 'existing_connection' });
	if (organizationPolicyProvider) signals.push({ provider: organizationPolicyProvider, weight: 0.85, source: 'organization_policy' });
	if (microsoftTenantHint) signals.push({ provider: 'microsoft', weight: 0.8, source: 'microsoft_tenant_hint' });
	if (KNOWN_GOOGLE_DOMAINS.has(domain)) signals.push({ provider: 'google', weight: 0.95, source: 'known_google_domain' });
	if (KNOWN_MICROSOFT_CONSUMER_DOMAINS.has(domain)) signals.push({ provider: 'microsoft', weight: 0.9, source: 'known_microsoft_consumer_domain' });
	if (capabilityProbeResult === 'google') signals.push({ provider: 'google', weight: 0.6, source: 'capability_probe' });
	if (capabilityProbeResult === 'microsoft') signals.push({ provider: 'microsoft', weight: 0.6, source: 'capability_probe' });
	// A custom/enterprise domain with no other signal is genuinely ambiguous (could be Google
	// Workspace or Microsoft 365) -- correctly contributes nothing, driving low confidence.

	const byProvider = new Map();
	for (const signal of signals) byProvider.set(signal.provider, (byProvider.get(signal.provider) || 0) + signal.weight);
	const ranked = [...byProvider.entries()].sort((a, b) => b[1] - a[1]);
	const [topProvider, topWeight] = ranked[0] || [null, 0];
	const totalWeight = signals.reduce((sum, s) => sum + s.weight, 0) || 1;
	const confidence = topProvider ? Math.min(1, topWeight / totalWeight) * Math.min(1, topWeight) : 0;

	return { signals, provider: topProvider, confidence, sufficient: confidence >= CONFIDENCE_THRESHOLD };
}

async function discoverProvider(c, scope, { onboardingMissionId, email, existingConnectionProvider = null, organizationPolicyProvider = null, microsoftTenantHint = null, capabilityProbeResult = null }) {
	const result = evaluateSignals({ email, existingConnectionProvider, organizationPolicyProvider, microsoftTenantHint, capabilityProbeResult });
	await c.env.db
		.prepare(`INSERT INTO mission_runtime_events(id,mission_id,tenant_id,workspace_id,event_type,detail_json) VALUES(?1,?2,?3,?4,'PROVIDER_DISCOVERY_EVALUATED',?5)`)
		.bind(crypto.randomUUID(), onboardingMissionId, scope.tenantId, scope.workspaceId, JSON.stringify({ domain: domainOf(email), provider: result.provider, confidence: result.confidence, sufficient: result.sufficient, signal_sources: result.signals.map((s) => s.source) }))
		.run();
	if (!result.sufficient) {
		// Never exposes a technical reason like "confidence 0.42 < 0.7" to the end user --
		// only the minimal fact that one choice is needed, and only the two supported options.
		return { ok: false, reason: 'PROVIDER_CHOICE_REQUIRED', candidates: ['google', 'microsoft'], confidence: result.confidence };
	}
	return { ok: true, provider: result.provider, confidence: result.confidence };
}

export { CONFIDENCE_THRESHOLD, evaluateSignals, domainOf };
export default { discoverProvider, evaluateSignals };
